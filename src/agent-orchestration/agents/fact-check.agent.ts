import { Injectable, NotFoundException } from '@nestjs/common';
import { AI_AUDIT_SOURCE_RANKING_FOLLOWUP } from '../../ai-audit/ai-audit.constants';
import { AI_AGENT_FACT_CHECK_V1 } from '../../agent/ai-agent.constants';
import { resolveAiAnalysisAgentKind } from '../../agent/ai-agent.constants';
import { PrismaService } from '../../prisma/prisma.service';

type ConflictRow = {
  entityId: string;
  entityName: string;
  metricKey: string;
  values: Array<{ value: number; sourceTier: number; observedAt: string }>;
  spread: number;
};

@Injectable()
export class FactCheckAgent {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: {
    snapshotId: string;
    topN?: number;
  }): Promise<{
    snapshotId: string;
    conflictCount: number;
    aiAnalysisId: string | null;
    summary: string;
    conflicts: ConflictRow[];
  }> {
    const snapshotId = BigInt(input.snapshotId.trim());
    const topN = Math.min(Math.max(input.topN ?? 10, 1), 50);

    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      include: {
        items: {
          orderBy: { rank: 'asc' },
          take: topN,
          include: { entity: true },
        },
      },
    });
    if (!snap) throw new NotFoundException('snapshot not found');

    const entityIds = snap.items.map((i) => i.entityId);
    const metrics = await this.prisma.entityMetric.findMany({
      where: { entityId: { in: entityIds } },
      orderBy: { observedAt: 'desc' },
      take: 500,
    });

    const byEntityMetric = new Map<string, typeof metrics>();
    for (const m of metrics) {
      const k = `${m.entityId}:${m.metricKey}`;
      const arr = byEntityMetric.get(k) ?? [];
      if (arr.length < 6) arr.push(m);
      byEntityMetric.set(k, arr);
    }

    const conflicts: ConflictRow[] = [];
    for (const item of snap.items) {
      for (const key of ['streams', 'mentions', 'social', 'news']) {
        const k = `${item.entityId}:${key}`;
        const rows = byEntityMetric.get(k) ?? [];
        if (rows.length < 2) continue;
        const vals = rows.map((r) => ({
          value: r.value,
          sourceTier: r.sourceTier,
          observedAt: r.observedAt.toISOString(),
        }));
        const spread =
          Math.max(...vals.map((v) => v.value)) -
          Math.min(...vals.map((v) => v.value));
        const tiers = new Set(vals.map((v) => v.sourceTier));
        if (spread < 12 && tiers.size < 2) continue;
        conflicts.push({
          entityId: item.entityId.toString(),
          entityName: item.entity.canonicalName,
          metricKey: key,
          values: vals,
          spread,
        });
      }
    }

    conflicts.sort((a, b) => b.spread - a.spread);
    const top = conflicts.slice(0, 15);
    const summary =
      top.length === 0
        ? `快照 #${snapshotId} 前 ${snap.items.length} 名未检出显著跨信源指标冲突。`
        : `快照 #${snapshotId}：检出 ${top.length} 处指标分歧（按 spread 排序）。` +
          top
            .slice(0, 5)
            .map(
              (c) =>
                `${c.entityName}/${c.metricKey} spread=${c.spread.toFixed(1)}`,
            )
            .join('；');

    const row = await this.prisma.aiAnalysis.create({
      data: {
        snapshotId,
        agent: AI_AGENT_FACT_CHECK_V1,
        summary: summary.slice(0, 4000),
        detailJson: {
          schemaVersion: 1,
          agentKind: resolveAiAnalysisAgentKind(AI_AGENT_FACT_CHECK_V1),
          conflictCount: top.length,
          conflicts: top,
          auditSource: AI_AUDIT_SOURCE_RANKING_FOLLOWUP,
        },
        confidence: top.length > 0 ? 0.72 : 0.88,
      },
    });

    return {
      snapshotId: snapshotId.toString(),
      conflictCount: top.length,
      aiAnalysisId: row.id.toString(),
      summary: row.summary,
      conflicts: top,
    };
  }
}
