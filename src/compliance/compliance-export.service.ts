import { Injectable, NotFoundException } from '@nestjs/common';
import { RankingsService } from '../rankings/rankings.service';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { ComplianceAuditService } from './compliance-audit.service';
import type { AuthenticatedRequestContext } from './compliance-auth.types';
import { redactAliases, redactCanonicalName } from './pii-redact';

export type ComplianceExportFormat = 'json' | 'csv';

@Injectable()
export class ComplianceExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rankings: RankingsService,
    private readonly audit: ComplianceAuditService,
  ) {}

  async exportSnapshotCompliance(args: {
    snapshotId: bigint;
    format: ComplianceExportFormat;
    auth?: AuthenticatedRequestContext;
  }): Promise<{ contentType: string; body: string }> {
    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: args.snapshotId },
      include: {
        scoreModel: true,
        items: {
          orderBy: { rank: 'asc' },
          include: {
            entity: { select: { id: true, canonicalName: true, piiLevel: true, aliases: true } },
            breakdowns: true,
          },
        },
        topicRanking: {
          include: {
            topicVersion: { include: { topic: { select: { id: true, slug: true, tenantId: true } } } },
          },
        },
      },
    });
    if (!snap) throw new NotFoundException('snapshot not found');

    const topicTenantId = snap.topicRanking.topicVersion.topic.tenantId;
    if (args.auth?.tenantId && topicTenantId && topicTenantId !== args.auth.tenantId) {
      throw new NotFoundException('snapshot not found');
    }

    const scopes = args.auth?.scopes ?? ['admin'];
    const relational = await this.rankings.getSnapshotRelationalScoreBreakdowns(args.snapshotId);

    const items = snap.items.map((it) => ({
      rank: it.rank,
      entityId: it.entityId.toString(),
      canonicalName: redactCanonicalName(it.entity.canonicalName, it.entity.piiLevel, scopes),
      piiLevel: it.entity.piiLevel,
      aliases: redactAliases(it.entity.aliases, it.entity.piiLevel, scopes),
      previousRank: it.previousRank,
      rankChange: it.rankChange,
      trendType: it.trendType,
      popularityScore: it.popularityScore,
      authorityScore: it.authorityScore,
      controversyScore: it.controversyScore,
      confidenceScore: it.confidenceScore,
      scoreBreakdown: it.scoreBreakdown,
      relationalBreakdowns: it.breakdowns.map((b) => ({
        component: b.component,
        value: b.value,
        weight: b.weight,
        note: b.note,
      })),
    }));

    const packageJson = toPlainJson({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshot: {
        id: snap.id.toString(),
        snapshotTime: snap.snapshotTime,
        snapshotVersion: snap.snapshotVersion,
        confidenceScore: snap.confidenceScore,
        generatedByAi: snap.generatedByAi,
        topicSlug: snap.topicRanking.topicVersion.topic.slug,
        topicVersionId: snap.topicRanking.topicVersionId.toString(),
        topicRankingId: snap.topicRankingId.toString(),
      },
      scoreModel: snap.scoreModel ? toPlainJson(snap.scoreModel) : null,
      relationalScoreBreakdowns: relational,
      items,
      explainabilityNote:
        'Each item includes JSON scoreBreakdown (materialized at ranking time) and optional ScoreBreakdown rows.',
    });

    await this.audit.record({
      action: 'SNAPSHOT_COMPLIANCE_EXPORT',
      actor: args.auth ? `apiKey:${args.auth.apiKeyId}` : 'anonymous',
      tenantId: args.auth?.tenantId ?? topicTenantId,
      resource: `snapshot:${snap.id}`,
      metadata: { format: args.format, itemCount: items.length },
    });

    if (args.format === 'csv') {
      return {
        contentType: 'text/csv; charset=utf-8',
        body: this.snapshotToCsv(items as Array<Record<string, unknown>>),
      };
    }

    return {
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(packageJson, null, 2),
    };
  }

  private snapshotToCsv(items: Array<Record<string, unknown>>): string {
    const header = [
      'rank',
      'entityId',
      'canonicalName',
      'piiLevel',
      'rankChange',
      'popularityScore',
      'authorityScore',
      'confidenceScore',
      'scoreBreakdownJson',
    ];
    const lines = [header.join(',')];
    for (const row of items) {
      const breakdown = JSON.stringify(row.scoreBreakdown ?? {});
      const cells = [
        row.rank,
        row.entityId,
        csvEscape(String(row.canonicalName ?? '')),
        row.piiLevel,
        row.rankChange ?? '',
        row.popularityScore,
        row.authorityScore,
        row.confidenceScore,
        csvEscape(breakdown),
      ];
      lines.push(cells.join(','));
    }
    return lines.join('\n');
  }
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
