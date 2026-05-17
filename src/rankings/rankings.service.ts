import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Entity,
  EntityMetric,
  Prisma,
  TimeWindow,
  TopicRanking,
  TopicRankSnapshot,
  TrendType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  aiConfidence,
  classifyTrend,
  leastSquaresSlope,
  robustMinMaxNormalize,
  scoreEntity,
  standardDev,
} from '../domain/scoring';
import {
  buildRankingJobId,
  RANKING_JOB_NAME,
  RANKING_QUEUE,
  type RankingJobPayload,
} from './ranking-job';
import { OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED } from '../outbox/outbox.constants';

type PolicyJson = {
  entityIds?: string[];
  weights: Record<string, number>;
  requiredSignalKeys?: string[];
};

const defaultWeights: Record<string, number> = {
  streams: 0.35,
  mentions: 0.25,
  social: 0.2,
  news: 0.2,
};

function toTrendType(label: string): TrendType {
  switch (label) {
    case 'SURGE':
      return TrendType.SURGE;
    case 'STEADY_UP':
      return TrendType.STEADY_UP;
    case 'STEADY_DOWN':
      return TrendType.STEADY_DOWN;
    case 'DECLINE':
      return TrendType.DECLINE;
    case 'VOLATILE':
      return TrendType.VOLATILE;
    case 'FLAT':
    default:
      return TrendType.FLAT;
  }
}

export type RunRankingArgs = {
  topicVersionId: bigint;
  timeWindow: TimeWindow;
  windowStart: Date;
  windowEnd: Date;
  asOf?: Date;
};

@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(RANKING_QUEUE) private readonly rankingQueue: Queue<RankingJobPayload>,
  ) {}

  async seedDemo(slug = 'global-female-singers') {
    const topic = await this.prisma.topic.upsert({
      where: { slug },
      update: { title: 'Global female singers (demo)' },
      create: {
        slug,
        title: 'Global female singers (demo)',
        kind: 'SEMI_OBJECTIVE',
        locale: 'en',
      },
    });

    const policy: PolicyJson = {
      weights: defaultWeights,
      requiredSignalKeys: ['streams', 'mentions', 'social'],
    };

    const version = await this.prisma.topicVersion.upsert({
      where: {
        topicId_version: { topicId: topic.id, version: '2026.05' },
      },
      update: { policyJson: policy as Prisma.InputJsonValue },
      create: {
        topicId: topic.id,
        version: '2026.05',
        effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
        policyJson: policy as Prisma.InputJsonValue,
      },
    });

    const entityDefs = [
      {
        name: 'Taylor Swift',
        metrics: [
          { key: 'streams', value: 92, tier: 1 },
          { key: 'mentions', value: 88, tier: 2 },
          { key: 'social', value: 95, tier: 3 },
          { key: 'news', value: 70, tier: 2 },
        ],
      },
      {
        name: 'Adele',
        metrics: [
          { key: 'streams', value: 78, tier: 1 },
          { key: 'mentions', value: 72, tier: 2 },
          { key: 'social', value: 60, tier: 3 },
          { key: 'news', value: 55, tier: 2 },
        ],
      },
      {
        name: 'Billie Eilish',
        metrics: [
          { key: 'streams', value: 85, tier: 1 },
          { key: 'mentions', value: 80, tier: 2 },
          { key: 'social', value: 90, tier: 3 },
          { key: 'news', value: 62, tier: 2 },
        ],
      },
    ] as const;

    const now = new Date();
    const entities: Entity[] = [];

    for (const def of entityDefs) {
      const entity = await this.prisma.entity.create({
        data: {
          type: 'PERSON',
          canonicalName: def.name,
        },
      });
      entities.push(entity);

      await this.prisma.entityMetric.createMany({
        data: def.metrics.map((m) => ({
          entityId: entity.id,
          metricKey: m.key,
          value: m.value,
          unit: 'index',
          sourceTier: m.tier,
          observedAt: new Date(now.getTime() - 2 * 86_400_000),
        })),
      });
    }

    const entityIds = entities.map((e) => e.id.toString());

    await this.prisma.topicVersion.update({
      where: { id: version.id },
      data: {
        policyJson: { ...policy, entityIds } as Prisma.InputJsonValue,
      },
    });

    const windowStart = new Date('2026-05-10T00:00:00.000Z');
    const windowEnd = new Date('2026-05-17T00:00:00.000Z');

    const v1 = await this.runRanking({
      topicVersionId: version.id,
      timeWindow: TimeWindow.WEEK,
      windowStart,
      windowEnd,
      asOf: new Date('2026-05-17T12:00:00.000Z'),
    });

    await this.prisma.entityMetric.createMany({
      data: [
        {
          entityId: entities[0].id,
          metricKey: 'streams',
          value: 96,
          unit: 'index',
          sourceTier: 1,
          observedAt: now,
        },
        {
          entityId: entities[1].id,
          metricKey: 'social',
          value: 68,
          unit: 'index',
          sourceTier: 3,
          observedAt: now,
        },
        {
          entityId: entities[2].id,
          metricKey: 'mentions',
          value: 84,
          unit: 'index',
          sourceTier: 2,
          observedAt: now,
        },
      ],
    });

    const v2 = await this.runRanking({
      topicVersionId: version.id,
      timeWindow: TimeWindow.WEEK,
      windowStart,
      windowEnd,
      asOf: new Date('2026-05-18T12:00:00.000Z'),
    });

    return {
      topicId: topic.id.toString(),
      topicVersionId: version.id.toString(),
      snapshots: [v1, v2],
    };
  }

  async listVersionsBySlug(slug: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { slug },
    });
    if (!topic) return [];
    return this.prisma.topicVersion.findMany({
      where: { topicId: topic.id },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getSnapshot(id: bigint) {
    return this.prisma.topicRankSnapshot.findUnique({
      where: { id },
      include: {
        items: { include: { entity: true }, orderBy: { rank: 'asc' } },
        topicRanking: { include: { topicVersion: { include: { topic: true } } } },
      },
    });
  }

  async getTopicRankingStatus(topicRankingId: bigint) {
    return this.prisma.topicRanking.findUnique({
      where: { id: topicRankingId },
      include: {
        topicVersion: { include: { topic: true } },
        snapshots: { orderBy: { snapshotTime: 'desc' }, take: 5 },
      },
    });
  }

  /** 同步：适合测试与小数据量 */
  async runRanking(args: RunRankingArgs) {
    const topicVersion = await this.loadTopicVersionOrThrow(args.topicVersionId);
    await this.assertEntitiesPresent(topicVersion, args);

    const now = new Date();
    const topicRanking = await this.prisma.topicRanking.upsert({
      where: {
        topicVersionId_timeWindow_windowStart: {
          topicVersionId: topicVersion.id,
          timeWindow: args.timeWindow,
          windowStart: args.windowStart,
        },
      },
      create: {
        topicVersionId: topicVersion.id,
        timeWindow: args.timeWindow,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
        status: 'running',
        queuedAt: now,
        startedAt: now,
        lastError: null,
        completedAt: null,
      },
      update: {
        status: 'running',
        windowEnd: args.windowEnd,
        startedAt: now,
        lastError: null,
        completedAt: null,
      },
    });

    try {
      const snapshot = await this.materializeRankingSnapshot(topicRanking, topicVersion, args);
      return this.serializeSnapshot(snapshot);
    } catch (err) {
      await this.prisma.topicRanking.update({
        where: { id: topicRanking.id },
        data: {
          status: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  /** 异步：入队，由 Worker 物化快照 */
  async enqueueRanking(args: RunRankingArgs): Promise<{
    jobId: string;
    topicRankingId: string;
    dedupedSnapshot?: boolean;
    snapshotId?: string;
  }> {
    const topicVersion = await this.loadTopicVersionOrThrow(args.topicVersionId);
    const entityIds = await this.resolveEntityIds(topicVersion, args.topicVersionId);
    if (entityIds.length === 0) throw new BadRequestException('no entities to rank');

    const snapshotTime = args.asOf ?? args.windowEnd;
    const queuedAt = new Date();

    const topicRanking = await this.prisma.topicRanking.upsert({
      where: {
        topicVersionId_timeWindow_windowStart: {
          topicVersionId: topicVersion.id,
          timeWindow: args.timeWindow,
          windowStart: args.windowStart,
        },
      },
      create: {
        topicVersionId: topicVersion.id,
        timeWindow: args.timeWindow,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
        status: 'queued',
        queuedAt,
        startedAt: null,
        lastError: null,
        completedAt: null,
      },
      update: {
        status: 'queued',
        windowEnd: args.windowEnd,
        queuedAt,
        lastError: null,
      },
    });

    const existingSnap = await this.prisma.topicRankSnapshot.findUnique({
      where: {
        topicRankingId_snapshotTime: {
          topicRankingId: topicRanking.id,
          snapshotTime,
        },
      },
    });
    if (existingSnap) {
      await this.prisma.topicRanking.update({
        where: { id: topicRanking.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          lastError: null,
        },
      });
      return {
        jobId: buildRankingJobId(this.toPayload(topicRanking.id, args)),
        topicRankingId: topicRanking.id.toString(),
        dedupedSnapshot: true,
        snapshotId: existingSnap.id.toString(),
      };
    }

    const payload = this.toPayload(topicRanking.id, args);
    const jobId = buildRankingJobId(payload);

    try {
      await this.rankingQueue.add(RANKING_JOB_NAME, payload, {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: false,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      });
    } catch (e: unknown) {
      const job = await this.rankingQueue.getJob(jobId);
      if (job) {
        return { jobId, topicRankingId: topicRanking.id.toString() };
      }
      throw e;
    }

    return { jobId, topicRankingId: topicRanking.id.toString() };
  }

  /** Bull Worker 调用：含状态机与幂等 */
  async processRankingJob(payload: RankingJobPayload): Promise<Record<string, unknown>> {
    const args: RunRankingArgs = {
      topicVersionId: BigInt(payload.topicVersionId),
      timeWindow: payload.timeWindow,
      windowStart: new Date(payload.windowStart),
      windowEnd: new Date(payload.windowEnd),
      asOf: payload.asOf ? new Date(payload.asOf) : undefined,
    };

    const topicRankingId = BigInt(payload.topicRankingId);
    const now = new Date();

    await this.prisma.topicRanking.updateMany({
      where: {
        id: topicRankingId,
        status: { in: ['queued', 'failed'] },
      },
      data: {
        status: 'running',
        startedAt: now,
        lastError: null,
      },
    });

    const topicRanking = await this.prisma.topicRanking.findUniqueOrThrow({
      where: { id: topicRankingId },
    });
    const topicVersion = await this.loadTopicVersionOrThrow(args.topicVersionId);

    try {
      const snap = await this.materializeRankingSnapshot(topicRanking, topicVersion, args);
      return this.serializeSnapshot(snap);
    } catch (err) {
      await this.prisma.topicRanking.update({
        where: { id: topicRankingId },
        data: {
          status: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  async getRankingJobState(jobId: string) {
    const job = await this.rankingQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return {
      id: job.id,
      name: job.name,
      state,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      data: job.data,
    };
  }

  private toPayload(topicRankingId: bigint, args: RunRankingArgs): RankingJobPayload {
    return {
      topicRankingId: topicRankingId.toString(),
      topicVersionId: args.topicVersionId.toString(),
      timeWindow: args.timeWindow,
      windowStart: args.windowStart.toISOString(),
      windowEnd: args.windowEnd.toISOString(),
      asOf: args.asOf?.toISOString(),
    };
  }

  private async loadTopicVersionOrThrow(id: bigint) {
    const topicVersion = await this.prisma.topicVersion.findUnique({ where: { id } });
    if (!topicVersion) throw new BadRequestException('topicVersion not found');
    return topicVersion;
  }

  private async assertEntitiesPresent(
    topicVersion: { id: bigint; policyJson: unknown },
    args: { topicVersionId: bigint },
  ) {
    const ids = await this.resolveEntityIds(topicVersion, args.topicVersionId);
    if (ids.length === 0) throw new BadRequestException('no entities to rank');
  }

  private async resolveEntityIds(
    topicVersion: { policyJson: unknown },
    _topicVersionId: bigint,
  ): Promise<bigint[]> {
    const policy = topicVersion.policyJson as unknown as PolicyJson;
    let entityIds = (policy.entityIds ?? []).map((x) => BigInt(x));
    if (entityIds.length === 0) {
      const distinct = await this.prisma.entityMetric.findMany({
        distinct: ['entityId'],
        select: { entityId: true },
      });
      entityIds = distinct.map((d) => d.entityId);
    }
    return entityIds;
  }

  /**
   * 幂等键：(topicRankingId, snapshotTime)。
   * snapshotVersion 由 topic 版本 + 窗口枚举 + 时间戳决定（无竞态序号）。
   */
  private async materializeRankingSnapshot(
    topicRanking: TopicRanking,
    topicVersion: { id: bigint; topicId: bigint; version: string; policyJson: unknown },
    args: RunRankingArgs,
  ) {
    const snapshotTime = args.asOf ?? args.windowEnd;
    const policy = topicVersion.policyJson as unknown as PolicyJson;
    const weights = policy.weights ?? defaultWeights;
    const required = new Set(policy.requiredSignalKeys ?? Object.keys(weights));

    const entityIds = await this.resolveEntityIds(topicVersion, topicVersion.id);
    if (entityIds.length === 0) throw new BadRequestException('no entities to rank');

    const existing = await this.prisma.topicRankSnapshot.findUnique({
      where: {
        topicRankingId_snapshotTime: {
          topicRankingId: topicRanking.id,
          snapshotTime,
        },
      },
      include: { items: { include: { entity: true }, orderBy: { rank: 'asc' } } },
    });
    if (existing) {
      await this.prisma.topicRanking.update({
        where: { id: topicRanking.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          lastError: null,
        },
      });
      return existing;
    }

    const snapshotVersion = `${topicVersion.version}.${args.timeWindow}.${snapshotTime.getTime()}`;

    const previousSnapshot = await this.prisma.topicRankSnapshot.findFirst({
      where: {
        topicRankingId: topicRanking.id,
        snapshotTime: { lt: snapshotTime },
      },
      orderBy: { snapshotTime: 'desc' },
      include: { items: true },
    });

    const prevRankByEntity = new Map<string, number>();
    for (const it of previousSnapshot?.items ?? []) {
      prevRankByEntity.set(it.entityId.toString(), it.rank);
    }

    const metrics = await this.prisma.entityMetric.findMany({
      where: {
        entityId: { in: entityIds },
        observedAt: { lte: snapshotTime },
      },
    });

    const byEntity = new Map<string, EntityMetric[]>();
    for (const m of metrics) {
      const k = m.entityId.toString();
      if (!byEntity.has(k)) byEntity.set(k, []);
      byEntity.get(k)!.push(m);
    }

    type Scored = {
      entityId: bigint;
      total: number;
      breakdown: Record<string, number>;
      coverage: number;
      avgTier: number;
      controversy: number;
      authority: number;
    };

    const scored: Scored[] = [];

    for (const entityId of entityIds) {
      const list = byEntity.get(entityId.toString()) ?? [];
      const latestByKey = new Map<string, EntityMetric>();
      for (const row of list) {
        const cur = latestByKey.get(row.metricKey);
        if (!cur || row.observedAt > cur.observedAt) latestByKey.set(row.metricKey, row);
      }

      const signals = [...latestByKey.entries()].map(([key, row]) => ({
        key,
        raw: row.value,
        observedAt: row.observedAt,
        tier: row.sourceTier,
      }));

      const presentKeys = new Set(signals.map((s) => s.key));
      const coverage =
        required.size === 0
          ? 1
          : [...required].filter((k) => presentKeys.has(k)).length / required.size;

      const { total, breakdown } = scoreEntity(signals, weights, snapshotTime);
      const tiers = signals.map((s) => s.tier);
      const avgTier = tiers.reduce((a, b) => a + b, 0) / Math.max(1, tiers.length);

      scored.push({
        entityId,
        total,
        breakdown,
        coverage,
        avgTier,
        controversy: standardDev(Object.values(breakdown)),
        authority: coverage,
      });
    }

    const totals = scored.map((s) => s.total);
    const normalizedTotals = robustMinMaxNormalize(totals);

    const rankRows = scored
      .map((s, i) => ({ s, n: normalizedTotals[i] }))
      .sort((a, b) => b.n - a.n);

    const itemsCreate: Prisma.RankingItemCreateWithoutSnapshotInput[] = [];

    for (let idx = 0; idx < rankRows.length; idx++) {
      const { s, n } = rankRows[idx];
      const rank = idx + 1;
      const prev = prevRankByEntity.get(s.entityId.toString());
      const rankChange = prev === undefined ? undefined : prev - rank;

      const historical = await this.prisma.rankingItemHistory.findMany({
        where: {
          entityId: s.entityId,
          topicId: topicVersion.topicId,
          timeWindow: args.timeWindow,
        },
        orderBy: { asOf: 'asc' },
        take: 32,
      });

      const series = [...historical.map((h) => h.score), n];
      const slope = leastSquaresSlope(series);
      const vol = standardDev(series.length > 1 ? series : [n, n]);
      const trendLabel = classifyTrend(slope, vol / Math.max(1e-6, Math.abs(n)));

      const confidence = aiConfidence(
        s.coverage,
        Math.min(1, standardDev(Object.values(s.breakdown))),
        s.avgTier,
      );

      itemsCreate.push({
        entity: { connect: { id: s.entityId } },
        rank,
        previousRank: prev,
        rankChange,
        trendType: toTrendType(trendLabel),
        trendScore: slope,
        popularityScore: n,
        authorityScore: s.authority,
        controversyScore: s.controversy,
        confidenceScore: confidence,
        scoreBreakdown: s.breakdown,
        timeWindow: args.timeWindow,
        snapshotVersion,
        generatedAt: snapshotTime,
      });
    }

    try {
      const result = await this.persistSnapshotTransaction(
        topicRanking.id,
        topicVersion,
        args,
        snapshotTime,
        snapshotVersion,
        itemsCreate,
      );
      return result;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const conflict = await this.prisma.topicRankSnapshot.findUniqueOrThrow({
          where: {
            topicRankingId_snapshotTime: {
              topicRankingId: topicRanking.id,
              snapshotTime,
            },
          },
          include: { items: { include: { entity: true }, orderBy: { rank: 'asc' } } },
        });
        await this.prisma.topicRanking.update({
          where: { id: topicRanking.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
            lastError: null,
          },
        });
        return conflict;
      }
      throw e;
    }
  }

  private async persistSnapshotTransaction(
    topicRankingId: bigint,
    topicVersion: { id: bigint; topicId: bigint; version: string },
    args: RunRankingArgs,
    snapshotTime: Date,
    snapshotVersion: string,
    itemsCreate: Prisma.RankingItemCreateWithoutSnapshotInput[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const snap = await tx.topicRankSnapshot.create({
        data: {
          topicRankingId,
          snapshotTime,
          snapshotVersion,
          rankingJson: { note: 'initial' } as Prisma.InputJsonValue,
          trendSummary: null,
          generatedByAi: false,
          confidenceScore: 0,
          items: { create: itemsCreate },
        },
        include: { items: { orderBy: { rank: 'asc' } } },
      });

      const confAvg =
        snap.items.reduce((a, it) => a + it.confidenceScore, 0) / Math.max(1, snap.items.length);

      await tx.topicRankSnapshot.update({
        where: { id: snap.id },
        data: {
          confidenceScore: confAvg,
          rankingJson: {
            topicVersion: topicVersion.version,
            window: args.timeWindow,
            snapshotTime: snapshotTime.toISOString(),
            items: snap.items.map((it) => ({
              entityId: it.entityId.toString(),
              rank: it.rank,
              score: it.popularityScore,
            })),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.rankingItemHistory.createMany({
        data: snap.items.map((it) => ({
          entityId: it.entityId,
          topicId: topicVersion.topicId,
          timeWindow: args.timeWindow,
          asOf: snapshotTime,
          rank: it.rank,
          score: it.popularityScore,
          snapshotId: snap.id,
        })),
      });

      await tx.topicRanking.update({
        where: { id: topicRankingId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          lastError: null,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
          payload: {
            schemaVersion: 1,
            snapshotId: snap.id.toString(),
            topicRankingId: topicRankingId.toString(),
            topicVersionId: topicVersion.id.toString(),
            topicId: topicVersion.topicId.toString(),
            topicVersionLabel: topicVersion.version,
            timeWindow: args.timeWindow,
            snapshotTime: snapshotTime.toISOString(),
            snapshotVersion,
            itemCount: snap.items.length,
            confidenceScore: confAvg,
          },
        },
      });

      return tx.topicRankSnapshot.findUniqueOrThrow({
        where: { id: snap.id },
        include: { items: { include: { entity: true }, orderBy: { rank: 'asc' } } },
      });
    });
  }

  private serializeSnapshot(s: TopicRankSnapshot & { items: unknown }) {
    return JSON.parse(
      JSON.stringify(s, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ) as Record<string, unknown>;
  }
}
