import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
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
  endStreakRankDeclining,
  endStreakRankImproving,
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
import { ClickhouseService } from '../analytics/clickhouse.service';
import { RankingCacheService } from '../cache/ranking-cache.service';
import {
  OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
  OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
} from '../outbox/outbox.constants';
import { toPlainJson } from '../lib/json';
import { elasticEntitySyncOutboxCreate } from '../search/elastic-entity-outbox';
import { ElasticService } from '../search/elastic.service';

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
  private readonly logger = new Logger(RankingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(RANKING_QUEUE) private readonly rankingQueue: Queue<RankingJobPayload>,
    private readonly rankingCache: RankingCacheService,
    private readonly elastic: ElasticService,
    @Optional() private readonly clickhouse?: ClickhouseService,
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

    if (this.elastic.isEnabled()) {
      await this.prisma.$transaction(async (tx) => {
        for (const def of entityDefs) {
          const entity = await tx.entity.create({
            data: {
              type: 'PERSON',
              canonicalName: def.name,
            },
          });
          entities.push(entity);

          await tx.entityMetric.createMany({
            data: def.metrics.map((m) => ({
              entityId: entity.id,
              metricKey: m.key,
              value: m.value,
              unit: 'index',
              sourceTier: m.tier,
              observedAt: new Date(now.getTime() - 2 * 86_400_000),
            })),
          });

          await tx.outboxEvent.create({
            data: elasticEntitySyncOutboxCreate(entity.id, 'upsert'),
          });
        }
      });
    } else {
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

  /**
   * HTTP API 用：优先读 Redis（与 DB 相同的 toPlainJson 形状）；缓存未命中再查库并回填。
   */
  async getSnapshotForApi(id: bigint): Promise<unknown | null> {
    const cached = await this.rankingCache.getSnapshotJson(id);
    if (cached) {
      try {
        return JSON.parse(cached) as unknown;
      } catch {
        /* 损坏条目，改走 DB */
      }
    }
    const snap = await this.loadSnapshotFull(id);
    if (!snap) return null;
    const plain = toPlainJson(snap);
    await this.rankingCache.setSnapshotJson(id, JSON.stringify(plain));
    return plain;
  }

  private snapshotInclude() {
    return {
      items: { include: { entity: true }, orderBy: { rank: 'asc' as const } },
      topicRanking: { include: { topicVersion: { include: { topic: true } } } },
    };
  }

  private async loadSnapshotFull(id: bigint) {
    return this.prisma.topicRankSnapshot.findUnique({
      where: { id },
      include: this.snapshotInclude(),
    });
  }

  private async warmSnapshotCache(snapshotId: bigint) {
    if (!this.rankingCache.isEnabled()) return;
    const snap = await this.loadSnapshotFull(snapshotId);
    if (!snap) return;
    const plain = toPlainJson(snap);
    await this.rankingCache.setSnapshotJson(snapshotId, JSON.stringify(plain));
  }

  /**
   * 按 slug 解析「当前」榜单：默认取最新 effectiveFrom 的 TopicVersion、最近完成的 TopicRanking（含快照），
   * 嵌套 `snapshot` 与 `GET /v1/snapshots/:id` 同源（再走快照 Redis）。
   */
  async getLeaderboardForApi(
    slug: string,
    query: { version?: string; timeWindow?: TimeWindow; windowStart?: string },
  ): Promise<unknown | null> {
    if (query.windowStart !== undefined && query.timeWindow === undefined) {
      throw new BadRequestException('timeWindow is required when windowStart is set');
    }

    const qKey = {
      version: query.version,
      timeWindow: query.timeWindow,
      windowStart: query.windowStart,
    };
    const cacheKey = this.rankingCache.leaderboardKey(slug, qKey);
    const cached = await this.rankingCache.getLeaderboardJson(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as unknown;
      } catch {
        /* 损坏则重算 */
      }
    }

    const topic = await this.prisma.topic.findUnique({ where: { slug } });
    if (!topic) return null;

    const topicVersion = query.version
      ? await this.prisma.topicVersion.findUnique({
          where: { topicId_version: { topicId: topic.id, version: query.version } },
        })
      : await this.prisma.topicVersion.findFirst({
          where: { topicId: topic.id },
          orderBy: { effectiveFrom: 'desc' },
        });
    if (!topicVersion) return null;

    let topicRanking: TopicRanking | null = null;

    if (query.timeWindow !== undefined && query.windowStart !== undefined) {
      topicRanking = await this.prisma.topicRanking.findFirst({
        where: {
          topicVersionId: topicVersion.id,
          timeWindow: query.timeWindow,
          windowStart: new Date(query.windowStart),
          snapshots: { some: {} },
        },
      });
    } else if (query.timeWindow !== undefined) {
      topicRanking = await this.prisma.topicRanking.findFirst({
        where: {
          topicVersionId: topicVersion.id,
          timeWindow: query.timeWindow,
          status: 'completed',
          snapshots: { some: {} },
        },
        orderBy: { windowStart: 'desc' },
      });
    } else {
      topicRanking = await this.prisma.topicRanking.findFirst({
        where: {
          topicVersionId: topicVersion.id,
          status: 'completed',
          snapshots: { some: {} },
        },
        orderBy: { windowStart: 'desc' },
      });
    }

    if (!topicRanking) return null;

    const snapshot = await this.prisma.topicRankSnapshot.findFirst({
      where: { topicRankingId: topicRanking.id },
      orderBy: { snapshotTime: 'desc' },
    });
    if (!snapshot) return null;

    const snapshotPayload = await this.getSnapshotForApi(snapshot.id);
    if (!snapshotPayload) return null;

    const body = {
      resolved: {
        topicSlug: topic.slug,
        topicTitle: topic.title,
        topicVersionId: topicVersion.id.toString(),
        version: topicVersion.version,
        timeWindow: topicRanking.timeWindow,
        windowStart: topicRanking.windowStart.toISOString(),
        windowEnd: topicRanking.windowEnd.toISOString(),
        topicRankingId: topicRanking.id.toString(),
        snapshotId: snapshot.id.toString(),
        snapshotTime: snapshot.snapshotTime.toISOString(),
      },
      snapshot: snapshotPayload,
    };

    await this.rankingCache.setLeaderboardJson(cacheKey, JSON.stringify(body));
    return body;
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
    await this.assertEntitiesPresent(topicVersion);

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
    const entityIds = await this.resolveEntityIds(topicVersion);
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

  private async assertEntitiesPresent(topicVersion: { id: bigint; policyJson: unknown }) {
    const ids = await this.resolveEntityIds(topicVersion);
    if (ids.length === 0) throw new BadRequestException('no entities to rank');
  }

  private async resolveEntityIds(topicVersion: { policyJson: unknown }): Promise<bigint[]> {
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

    const entityIds = await this.resolveEntityIds(topicVersion);
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
      await this.warmSnapshotCache(existing.id);
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
      await this.maybeSyncRankingSnapshotToClickhouse(
        result,
        topicVersion.topicId,
        snapshotTime,
        args.timeWindow,
      );
      await this.warmSnapshotCache(result.id);
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
        await this.warmSnapshotCache(conflict.id);
        return conflict;
      }
      throw e;
    }
  }

  private async maybeSyncRankingSnapshotToClickhouse(
    snapshot: TopicRankSnapshot & {
      items: Array<{ entityId: bigint; popularityScore: number; rank: number }>;
    },
    topicId: bigint,
    snapshotTime: Date,
    timeWindow: TimeWindow,
  ) {
    if (process.env.SYNC_RANKING_TO_CLICKHOUSE !== 'true') return;
    const mode = (process.env.CLICKHOUSE_WRITE_MODE ?? 'direct').toLowerCase();
    if (mode === 'outbox') return;
    if (!this.clickhouse?.isEnabled()) return;
    try {
      await this.clickhouse.ingestRankingSnapshot({
        snapshotId: snapshot.id,
        topicId,
        snapshotTime,
        timeWindow,
        items: snapshot.items.map((it) => ({
          entityId: it.entityId,
          popularityScore: it.popularityScore,
          rank: it.rank,
        })),
      });
    } catch (e) {
      this.logger.warn(
        `ClickHouse ingest failed for snapshot ${snapshot.id.toString()}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
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

      const itemsForTrend = await tx.rankingItem.findMany({
        where: { snapshotId: snap.id },
        include: { entity: { select: { canonicalName: true } } },
        orderBy: { rank: 'asc' },
      });
      await tx.trendAnalysis.create({
        data: {
          topicId: topicVersion.topicId,
          entityId: null,
          window: args.timeWindow,
          payload: this.buildSnapshotTrendAnalysisPayload({
            snapshotId: snap.id,
            topicRankingId,
            topicVersionId: topicVersion.id,
            snapshotTime,
            timeWindow: args.timeWindow,
            snapshotVersion,
            items: itemsForTrend,
            confidenceAvg: confAvg,
          }),
        },
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

      const chOutbox =
        process.env.SYNC_RANKING_TO_CLICKHOUSE === 'true' &&
        (process.env.CLICKHOUSE_WRITE_MODE ?? 'direct').toLowerCase() === 'outbox' &&
        this.clickhouse?.isEnabled();
      if (chOutbox) {
        await tx.outboxEvent.create({
          data: {
            type: OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
            payload: {
              schemaVersion: 1,
              snapshotId: snap.id.toString(),
            },
          },
        });
      }

      return tx.topicRankSnapshot.findUniqueOrThrow({
        where: { id: snap.id },
        include: { items: { include: { entity: true }, orderBy: { rank: 'asc' } } },
      });
    });
  }

  private buildSnapshotTrendAnalysisPayload(args: {
    snapshotId: bigint;
    topicRankingId: bigint;
    topicVersionId: bigint;
    snapshotTime: Date;
    timeWindow: TimeWindow;
    snapshotVersion: string;
    confidenceAvg: number;
    items: Array<{
      entityId: bigint;
      rank: number;
      previousRank: number | null;
      rankChange: number | null;
      trendType: TrendType;
      confidenceScore: number;
      popularityScore: number;
      entity: { canonicalName: string };
    }>;
  }): Prisma.InputJsonValue {
    const trendTypeCounts: Record<string, number> = {};
    for (const it of args.items) {
      const k = it.trendType;
      trendTypeCounts[k] = (trendTypeCounts[k] ?? 0) + 1;
    }
    const movers = args.items.filter(
      (i) => i.rankChange != null && i.previousRank != null,
    );
    const topRankGainers = [...movers]
      .filter((i) => (i.rankChange ?? 0) > 0)
      .sort((a, b) => (b.rankChange ?? 0) - (a.rankChange ?? 0))
      .slice(0, 10)
      .map((i) => ({
        entityId: i.entityId.toString(),
        canonicalName: i.entity.canonicalName,
        previousRank: i.previousRank,
        rank: i.rank,
        rankChange: i.rankChange,
      }));
    const topRankLosers = [...movers]
      .filter((i) => (i.rankChange ?? 0) < 0)
      .sort((a, b) => (a.rankChange ?? 0) - (b.rankChange ?? 0))
      .slice(0, 10)
      .map((i) => ({
        entityId: i.entityId.toString(),
        canonicalName: i.entity.canonicalName,
        previousRank: i.previousRank,
        rank: i.rank,
        rankChange: i.rankChange,
      }));
    return {
      schemaVersion: 1,
      kind: 'snapshot_summary',
      snapshotId: args.snapshotId.toString(),
      topicRankingId: args.topicRankingId.toString(),
      topicVersionId: args.topicVersionId.toString(),
      snapshotTime: args.snapshotTime.toISOString(),
      timeWindow: args.timeWindow,
      snapshotVersion: args.snapshotVersion,
      itemCount: args.items.length,
      avgConfidence: args.confidenceAvg,
      trendTypeCounts,
      topRankGainers,
      topRankLosers,
    };
  }

  /**
   * 某话题近期快照级趋势摘要（`TrendAnalysis.entityId` 为 null）。
   */
  async listTrendAnalysesForTopicSlug(
    slug: string,
    timeWindow?: TimeWindow,
    limit = 20,
  ) {
    const s = slug.trim();
    const topic = await this.prisma.topic.findUnique({
      where: { slug: s },
      select: { id: true, slug: true, title: true },
    });
    if (!topic) throw new NotFoundException('topic not found');

    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.trendAnalysis.findMany({
      where: {
        topicId: topic.id,
        entityId: null,
        ...(timeWindow ? { window: timeWindow } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        window: true,
        payload: true,
        createdAt: true,
      },
    });

    return toPlainJson({
      topic: {
        id: topic.id.toString(),
        slug: topic.slug,
        title: topic.title,
      },
      filter: { timeWindow: timeWindow ?? null, limit: take },
      count: rows.length,
      analyses: rows.map((r) => ({
        id: r.id.toString(),
        window: r.window,
        createdAt: r.createdAt.toISOString(),
        payload: r.payload,
      })),
    });
  }

  /**
   * 某话题下近期物化的排行榜快照（跨 `TopicVersion` / `TopicRanking`）。
   */
  async listSnapshotsForTopicSlug(
    slug: string,
    timeWindow?: TimeWindow,
    limit = 30,
  ) {
    const s = slug.trim();
    const topic = await this.prisma.topic.findUnique({
      where: { slug: s },
      select: { id: true, slug: true, title: true },
    });
    if (!topic) throw new NotFoundException('topic not found');

    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.topicRankSnapshot.findMany({
      where: {
        topicRanking: {
          topicVersion: { topicId: topic.id },
          ...(timeWindow ? { timeWindow } : {}),
        },
      },
      orderBy: { snapshotTime: 'desc' },
      take,
      select: {
        id: true,
        snapshotTime: true,
        snapshotVersion: true,
        confidenceScore: true,
        generatedByAi: true,
        topicRankingId: true,
        topicRanking: {
          select: {
            id: true,
            timeWindow: true,
            windowStart: true,
            windowEnd: true,
            status: true,
            topicVersion: {
              select: { id: true, version: true },
            },
          },
        },
      },
    });

    return toPlainJson({
      topic: {
        id: topic.id.toString(),
        slug: topic.slug,
        title: topic.title,
      },
      filter: { timeWindow: timeWindow ?? null, limit: take },
      count: rows.length,
      snapshots: rows.map((r) => ({
        id: r.id.toString(),
        snapshotTime: r.snapshotTime.toISOString(),
        snapshotVersion: r.snapshotVersion,
        confidenceScore: r.confidenceScore,
        generatedByAi: r.generatedByAi,
        topicRankingId: r.topicRankingId.toString(),
        topicRanking: {
          id: r.topicRanking.id.toString(),
          timeWindow: r.topicRanking.timeWindow,
          windowStart: r.topicRanking.windowStart.toISOString(),
          windowEnd: r.topicRanking.windowEnd.toISOString(),
          status: r.topicRanking.status,
          topicVersionId: r.topicRanking.topicVersion.id.toString(),
          topicVersionLabel: r.topicRanking.topicVersion.version,
        },
      })),
    });
  }

  /**
   * 某实体在话题下的排行时间序列（`RankingItemHistory`），含历史最好/最差名次与末端连续升降步数。
   */
  async getEntityRankHistory(
    entityId: bigint,
    topicSlug: string,
    timeWindow?: TimeWindow,
    limit = 100,
  ) {
    const slug = topicSlug.trim();
    const topic = await this.prisma.topic.findUnique({ where: { slug } });
    if (!topic) throw new NotFoundException('topic not found');
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true, canonicalName: true, type: true },
    });
    if (!entity) throw new NotFoundException('entity not found');

    const take = Math.min(Math.max(limit, 1), 500);
    const rowsDesc = await this.prisma.rankingItemHistory.findMany({
      where: {
        entityId,
        topicId: topic.id,
        ...(timeWindow ? { timeWindow } : {}),
      },
      orderBy: { asOf: 'desc' },
      take,
      select: {
        asOf: true,
        rank: true,
        score: true,
        timeWindow: true,
        snapshotId: true,
      },
    });
    const points = rowsDesc.slice().reverse();

    let summary:
      | {
          bestRank: number;
          worstRank: number;
          endStreakRankImproving: number;
          endStreakRankDeclining: number;
          pointCount: number;
        }
      | null = null;

    if (points.length > 0) {
      const ranks = points.map((p) => p.rank);
      summary = {
        bestRank: Math.min(...ranks),
        worstRank: Math.max(...ranks),
        endStreakRankImproving: endStreakRankImproving(points),
        endStreakRankDeclining: endStreakRankDeclining(points),
        pointCount: points.length,
      };
    }

    return toPlainJson({
      entity: {
        id: entity.id.toString(),
        canonicalName: entity.canonicalName,
        type: entity.type,
      },
      topic: { id: topic.id.toString(), slug: topic.slug },
      filter: { timeWindow: timeWindow ?? null, limit: take },
      points: points.map((p) => ({
        asOf: p.asOf.toISOString(),
        rank: p.rank,
        score: p.score,
        timeWindow: p.timeWindow,
        snapshotId: p.snapshotId.toString(),
      })),
      summary,
    });
  }

  /**
   * 并列对比若干快照的名次（须同属一个 TopicRanking）；`snapshotIds` 先去重并保持顺序。
   */
  async compareSnapshots(rawIds: bigint[]) {
    const seen = new Set<string>();
    const snapshotIds: bigint[] = [];
    for (const id of rawIds) {
      const k = id.toString();
      if (seen.has(k)) continue;
      seen.add(k);
      snapshotIds.push(id);
    }
    if (snapshotIds.length < 2) {
      throw new BadRequestException('need at least 2 distinct snapshot ids');
    }
    if (snapshotIds.length > 10) {
      throw new BadRequestException('at most 10 snapshots');
    }

    const snaps = await this.prisma.topicRankSnapshot.findMany({
      where: { id: { in: snapshotIds } },
      include: {
        items: { include: { entity: true }, orderBy: { rank: 'asc' } },
      },
    });
    if (snaps.length !== snapshotIds.length) {
      throw new BadRequestException('one or more snapshots not found');
    }

    const snapById = new Map(snaps.map((s) => [s.id.toString(), s]));
    const ordered = snapshotIds.map((id) => {
      const s = snapById.get(id.toString());
      if (!s) throw new BadRequestException('snapshot not found');
      return s;
    });

    const topicRankingId = ordered[0].topicRankingId;
    for (const s of ordered) {
      if (s.topicRankingId !== topicRankingId) {
        throw new BadRequestException(
          'all snapshots must belong to the same TopicRanking',
        );
      }
    }

    type EntityRow = {
      entityId: string;
      canonicalName: string;
      bySnapshot: Record<
        string,
        {
          rank: number;
          popularityScore: number;
          rankChange: number | null;
        }
      >;
    };
    const entityMap = new Map<string, EntityRow>();

    for (const snap of ordered) {
      const sid = snap.id.toString();
      for (const it of snap.items) {
        const eid = it.entityId.toString();
        let row = entityMap.get(eid);
        if (!row) {
          row = {
            entityId: eid,
            canonicalName: it.entity.canonicalName,
            bySnapshot: {},
          };
          entityMap.set(eid, row);
        }
        row.bySnapshot[sid] = {
          rank: it.rank,
          popularityScore: it.popularityScore,
          rankChange: it.rankChange,
        };
      }
    }

    const firstSid = ordered[0].id.toString();
    const rows = Array.from(entityMap.values()).sort((a, b) => {
      const rA = a.bySnapshot[firstSid]?.rank ?? 99999;
      const rB = b.bySnapshot[firstSid]?.rank ?? 99999;
      return rA - rB;
    });

    return {
      topicRankingId: topicRankingId.toString(),
      snapshots: ordered.map((s) => ({
        id: s.id.toString(),
        snapshotTime: s.snapshotTime.toISOString(),
        snapshotVersion: s.snapshotVersion,
      })),
      rowCount: rows.length,
      rows,
    };
  }

  private serializeSnapshot(s: TopicRankSnapshot & { items: unknown }) {
    return JSON.parse(
      JSON.stringify(s, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ) as Record<string, unknown>;
  }
}
