import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClickhouseService } from '../analytics/clickhouse.service';
import {
  entityHasRequiredSignals,
  indexEntitySignals,
  signalCoverage,
} from '../domain/entity-signals';
import {
  mergePolicyWithTopicKind,
  topicKindPreset,
  topicKindStrategyPublic,
} from '../domain/topic-kind-policy';
import { parseRankingPolicyJson, type RankingPolicyJson } from '../domain/policy-json';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';

export type EntityMetricIngestRow = {
  metricKey: string;
  value: number;
  observedAt: Date;
  unit?: string | null;
  sourceTier?: number;
};

const defaultWeights: Record<string, number> = {
  streams: 0.35,
  mentions: 0.25,
  social: 0.2,
  news: 0.2,
};

@Injectable()
export class EntityMetricsService {
  private readonly logger = new Logger(EntityMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly clickhouse?: ClickhouseService,
  ) {}

  async listEntityMetrics(
    entityId: bigint,
    opts: {
      metricKey?: string;
      since?: Date;
      limit?: number;
      latestOnly?: boolean;
    } = {},
  ) {
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity) throw new NotFoundException('entity not found');

    const take = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const rows = await this.prisma.entityMetric.findMany({
      where: {
        entityId,
        ...(opts.metricKey ? { metricKey: opts.metricKey.trim() } : {}),
        ...(opts.since ? { observedAt: { gte: opts.since } } : {}),
      },
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: opts.latestOnly ? undefined : take,
    });

    if (opts.latestOnly) {
      const latest = indexEntitySignals(
        rows,
        [entityId],
        new Date('9999-12-31T23:59:59.999Z'),
      )[0];
      const byKey = latest?.latestByKey ?? new Map();
      const latestRows = [...byKey.values()].sort(
        (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
      );
      return toPlainJson({
        entityId: entityId.toString(),
        latestOnly: true,
        count: latestRows.length,
        metrics: latestRows.slice(0, take),
      });
    }

    return toPlainJson({
      entityId: entityId.toString(),
      count: rows.length,
      metrics: rows,
    });
  }

  async ingestEntityMetrics(
    entityId: bigint,
    rows: EntityMetricIngestRow[],
    opts: { topicId?: bigint } = {},
  ) {
    if (rows.length === 0) {
      throw new BadRequestException('metrics must be a non-empty array');
    }
    if (rows.length > 200) {
      throw new BadRequestException('at most 200 metrics per request');
    }

    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity) throw new NotFoundException('entity not found');

    const data: Prisma.EntityMetricCreateManyInput[] = [];
    for (const row of rows) {
      const metricKey = row.metricKey.trim();
      if (!metricKey || metricKey.length > 120) {
        throw new BadRequestException('metricKey must be 1–120 chars');
      }
      if (!Number.isFinite(row.value)) {
        throw new BadRequestException(`invalid value for metricKey "${metricKey}"`);
      }
      const tier = row.sourceTier ?? 3;
      if (!Number.isInteger(tier) || tier < 1 || tier > 5) {
        throw new BadRequestException('sourceTier must be integer 1–5');
      }
      data.push({
        entityId,
        metricKey,
        value: row.value,
        unit: row.unit?.trim() || null,
        sourceTier: tier,
        observedAt: row.observedAt,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.entityMetric.createMany({ data });
      return tx.entityMetric.findMany({
        where: {
          entityId,
          OR: data.map((d) => ({
            metricKey: d.metricKey,
            observedAt: d.observedAt,
          })),
        },
        orderBy: { id: 'desc' },
        take: data.length,
      });
    });

    await this.maybeSyncEntityMetricsToClickhouse(entityId, data, opts.topicId);

    return toPlainJson({
      entityId: entityId.toString(),
      ingested: data.length,
      metrics: created,
    });
  }

  async previewTopicVersionSignals(topicVersionId: bigint, asOf?: Date) {
    const topicVersion = await this.prisma.topicVersion.findUnique({
      where: { id: topicVersionId },
      include: { topic: { select: { id: true, kind: true, slug: true } } },
    });
    if (!topicVersion) throw new NotFoundException('topicVersion not found');

    const snapshotTime = asOf ?? new Date();
    let policy: RankingPolicyJson;
    try {
      policy = parseRankingPolicyJson(topicVersion.policyJson);
    } catch {
      policy = { weights: { ...defaultWeights } };
    }
    policy = mergePolicyWithTopicKind(topicVersion.topic.kind, policy);
    const requiredKeys = policy.requiredSignalKeys ?? Object.keys(policy.weights);
    const required = [...new Set(requiredKeys)];
    const minCoverage = topicKindPreset(topicVersion.topic.kind).minCoverageToRank;

    let entityIds = (policy.entityIds ?? []).map((x) => BigInt(x));
    if (entityIds.length === 0) {
      const distinct = await this.prisma.entityMetric.findMany({
        distinct: ['entityId'],
        select: { entityId: true },
      });
      entityIds = distinct.map((d) => d.entityId);
    }

    const metrics = await this.prisma.entityMetric.findMany({
      where: {
        entityId: { in: entityIds },
        observedAt: { lte: snapshotTime },
      },
    });

    const indexed = indexEntitySignals(metrics, entityIds, snapshotTime);
    const entities = await this.prisma.entity.findMany({
      where: { id: { in: entityIds } },
      select: { id: true, canonicalName: true },
    });
    const nameById = new Map(entities.map((e) => [e.id.toString(), e.canonicalName]));

    let eligibleCount = 0;
    const perEntity = indexed.map((idx) => {
      const coverage = signalCoverage(idx.presentKeys, required);
      const hasRequired = entityHasRequiredSignals(idx.signalRows, required, snapshotTime);
      const rankEligible = coverage >= minCoverage;
      if (rankEligible) eligibleCount += 1;
      const missingKeys = required.filter((k) => !idx.presentKeys.includes(k));
      return {
        entityId: idx.entityId.toString(),
        canonicalName: nameById.get(idx.entityId.toString()) ?? null,
        presentKeys: idx.presentKeys,
        missingKeys,
        coverage,
        hasRequiredSignals: hasRequired,
        rankEligible,
        latestSignals: [...idx.latestByKey.entries()].map(([metricKey, m]) => ({
          metricKey,
          value: m.value,
          observedAt: m.observedAt.toISOString(),
          sourceTier: m.sourceTier,
        })),
      };
    });

    return toPlainJson({
      topicVersionId: topicVersionId.toString(),
      topicId: topicVersion.topicId.toString(),
      topicSlug: topicVersion.topic.slug,
      asOf: snapshotTime.toISOString(),
      kindStrategy: {
        ...topicKindStrategyPublic(topicVersion.topic.kind),
        appliedWeights: policy.weights,
        appliedDecay: policy.decay,
      },
      entityCount: entityIds.length,
      eligibleCount,
      excludedByMissingSignals: entityIds.length - eligibleCount,
      requiredSignalKeys: required,
      minCoverageToRank: minCoverage,
      entities: perEntity,
    });
  }

  private async maybeSyncEntityMetricsToClickhouse(
    entityId: bigint,
    rows: Prisma.EntityMetricCreateManyInput[],
    topicId?: bigint,
  ) {
    if (process.env.SYNC_RANKING_TO_CLICKHOUSE !== 'true') return;
    const mode = (process.env.CLICKHOUSE_WRITE_MODE ?? 'direct').toLowerCase();
    if (mode === 'outbox') return;
    if (!this.clickhouse?.isEnabled()) return;

    try {
      await this.clickhouse.ingestEntityMetrics({
        topicId: topicId ?? 0n,
        entityId,
        metrics: rows.map((r) => ({
          metricKey: r.metricKey,
          value: r.value,
          sourceTier: r.sourceTier ?? 3,
          observedAt: r.observedAt as Date,
        })),
      });
    } catch (e) {
      this.logger.warn(
        `ClickHouse entity metric ingest failed for entity ${entityId.toString()}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
