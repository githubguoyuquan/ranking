import { rankingHistorySummary } from '../domain/ranking-history-summary';
import { entityWhereForAuth } from '../compliance/tenant-scope';
import { redactEntityRecord } from '../compliance/entity-pii';
import { resolveRealtimeRankingWindow } from '../domain/realtime-ranking-window';
import { TopicRankingQuery, leaderboardResolved } from './queries/topic-ranking.query';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Entity,
  Prisma,
  TopicKind,
  TimeWindow,
  TopicRanking,
  TopicRankSnapshot,
  TrendType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReadService } from '../scale/prisma-read.service';
import { RealtimePublisherService } from '../realtime/realtime-publisher.service';
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
import {
  buildRankingFollowupJobId,
  RANKING_FOLLOWUP_JOB_NAME,
  RANKING_FOLLOWUP_QUEUE,
  type RankingFollowupPayload,
} from './ranking-followup-job';
import { ClickhouseService } from '../analytics/clickhouse.service';
import { RankingCacheService } from '../cache/ranking-cache.service';
import {
  OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
  OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
} from '../outbox/outbox.constants';
import { toPlainJson } from '../lib/json';
import { elasticEntitySyncOutboxCreate } from '../search/elastic-entity-outbox';
import { ElasticService } from '../search/elastic.service';
import { QdrantSearchService } from '../search/qdrant-search.service';
import { upsertEntityTopicStatsBatch } from '../domain/entity-topic-stats';
import { parseRankingPolicyJson, type RankingPolicyJson } from '../domain/policy-json';
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
import type { ApiKeyScope } from '../compliance/pii-redact';
import { redactSnapshotPlainForScopes } from '../compliance/entity-pii';
import type { AuthenticatedRequestContext } from '../compliance/compliance-auth.types';
import { assertTopicAccessible, topicWhereForAuth } from '../compliance/tenant-scope';
import { AgentOrchestrationService } from '../agent-orchestration/agent-orchestration.service';
import {
  AI_ANALYSIS_BRIEF_SPECS,
  type AiAnalysisBriefField,
} from '../agent/ai-agent.constants';
import {
  parseScoreBreakdownJson,
  stableWeightsFingerprint,
} from './score-model-utils';
import { toRankingSnapshotPlainJson } from './snapshot-plain-json';
import { buildClickhouseRankingSnapshotOutboxPayload } from './clickhouse-ranking-snapshot-outbox-payload';
import { buildRankingSnapshotCompletedOutboxPayload } from './ranking-snapshot-completed-outbox-payload';
import { randomUUID } from 'node:crypto';
import { TopicEntityAutofillService, publicEntityAutofill } from './topic-entity-autofill.service';
import { TopicMetricPlanService } from './topic-metric-plan.service';

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

export type CreateTopicArgs = {
  slug: string;
  title: string;
  entityScope?: string;
  kind: TopicKind;
  locale?: string;
  entityCount?: number;
};

export type CreateTopicVersionArgs = {
  version: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  policyJson: unknown;
};

@Injectable()
export class RankingsService {
  private readonly logger = new Logger(RankingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(RANKING_QUEUE) private readonly rankingQueue: Queue<RankingJobPayload>,
    @InjectQueue(RANKING_FOLLOWUP_QUEUE)
    private readonly rankingFollowupQueue: Queue<RankingFollowupPayload>,
    private readonly agentOrchestration: AgentOrchestrationService,
    private readonly rankingCache: RankingCacheService,
    private readonly elastic: ElasticService,
    private readonly qdrant: QdrantSearchService,
    private readonly realtime: RealtimePublisherService,
    @Optional() private readonly clickhouse?: ClickhouseService,
    @Optional() private readonly prismaRead?: PrismaReadService,
    @Optional() private readonly entityAutofill?: TopicEntityAutofillService,
    @Optional() private readonly metricPlanning?: TopicMetricPlanService,
  ) {}

  /** 读多路径优先只读副本（`DATABASE_READ_URL`） */
  private get readPrisma(): PrismaService | PrismaReadService {
    return this.prismaRead ?? this.prisma;
  }

  private async emitSnapshotReadyEvent(
    snapshot: TopicRankSnapshot,
    topicRanking: Pick<TopicRanking, 'id'>,
    topicVersion: { id: bigint; topicId: bigint },
    opts?: { deduped?: boolean },
  ): Promise<void> {
    try {
      const topic = await this.prisma.topic.findUnique({
        where: { id: topicVersion.topicId },
        select: { slug: true },
      });
      if (!topic) return;
      await this.realtime.publish({
        type: 'snapshot_ready',
        topicSlug: topic.slug,
        topicVersionId: topicVersion.id.toString(),
        topicRankingId: topicRanking.id.toString(),
        snapshotId: snapshot.id.toString(),
        hasScoreModel: snapshot.scoreModelId != null,
        deduped: opts?.deduped,
      });
    } catch (e) {
      this.logger.warn(
        `realtime snapshot_ready: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async emitRankingFailedEvent(
    topicRankingId: bigint,
    topicVersionId: bigint,
    err: unknown,
  ): Promise<void> {
    try {
      const tv = await this.prisma.topicVersion.findUnique({
        where: { id: topicVersionId },
        select: { topic: { select: { slug: true } } },
      });
      const slug = tv?.topic.slug;
      if (!slug) return;
      const msg = err instanceof Error ? err.message : String(err);
      await this.realtime.publish({
        type: 'ranking_failed',
        topicSlug: slug,
        topicVersionId: topicVersionId.toString(),
        topicRankingId: topicRankingId.toString(),
        error: msg.slice(0, 500),
      });
    } catch (e) {
      this.logger.warn(
        `realtime ranking_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** 运营台手工创建话题；slug 全局唯一，租户来自当前鉴权上下文。 */
  async listTopics(
    args: { q?: string; limit?: number },
    auth?: AuthenticatedRequestContext,
  ) {
    const q = args.q?.trim();
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    const topics = await this.readPrisma.topic.findMany({
      where: {
        ...topicWhereForAuth(auth),
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' as const } },
                { slug: { contains: q, mode: 'insensitive' as const } },
                { entityScope: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        slug: true,
        title: true,
        entityScope: true,
        kind: true,
        locale: true,
        isOnline: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { versions: true } },
      },
    });
    return toPlainJson({
      count: topics.length,
      topics: topics.map((topic) => ({
        ...topic,
        versionCount: topic._count.versions,
        _count: undefined,
      })),
    });
  }

  /** 运营台手工创建话题；slug 全局唯一，租户来自当前鉴权上下文。 */
  async createTopic(
    args: CreateTopicArgs,
    auth?: AuthenticatedRequestContext,
  ) {
    const slug = args.slug.trim();
    const title = args.title.trim();
    const entityScope = args.entityScope?.trim() || undefined;
    const locale = args.locale?.trim() || 'en';
    if (!slug) throw new BadRequestException('topic slug is required');
    if (!title) throw new BadRequestException('topic title is required');
    if (args.entityCount !== undefined && (!Number.isInteger(args.entityCount) || args.entityCount < 1)) {
      throw new BadRequestException('自动填充实体数量必须是正整数。');
    }
    if (args.entityCount !== undefined && !this.entityAutofill) {
      throw new BadRequestException('自动填充服务尚未启用。');
    }
    if (args.entityCount !== undefined && !entityScope) {
      throw new BadRequestException('自动填充实体时请填写参榜实体类别。');
    }
    const runToken = args.entityCount !== undefined ? randomUUID() : undefined;
    const metricPlan = this.metricPlanning
      ? await this.metricPlanning.suggest({ title, kind: args.kind, locale })
      : undefined;

    try {
      const topic = await this.prisma.topic.create({
        data: {
          slug,
          title,
          ...(entityScope ? { entityScope } : {}),
          kind: args.kind,
          locale,
          ...(metricPlan
            ? { metricPlan: metricPlan as unknown as Prisma.InputJsonValue }
            : {}),
          ...(runToken ? { entityAutofill: { create: { requestedCount: args.entityCount!, runToken } } } : {}),
          ...(auth?.tenantId != null
            ? { tenant: { connect: { id: auth.tenantId } } }
            : {}),
        },
      });
      const entityAutofill = runToken
        ? await this.entityAutofill!.enqueue(topic.id, runToken)
        : null;
      return toPlainJson({
        ...topic,
        kindStrategy: topicKindStrategyPublic(topic.kind),
        metricPlan,
        entityAutofill,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(`topic slug already exists: ${slug}`);
      }
      throw e;
    }
  }

  /**
   * 为已有话题创建新规则版本。运营入口要求显式 entityIds，避免把全库实体意外带入正式榜单。
   */
  async createTopicVersion(
    slug: string,
    args: CreateTopicVersionArgs,
    auth?: AuthenticatedRequestContext,
  ) {
    const topic = await this.prisma.topic.findFirst({
      where: { slug: slug.trim(), ...topicWhereForAuth(auth) },
    });
    if (!topic) throw new NotFoundException('topic not found');
    await assertTopicAccessible(topic, auth);

    let policy: RankingPolicyJson;
    try {
      policy = parseRankingPolicyJson(args.policyJson);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'invalid policyJson',
      );
    }

    if (!policy.entityIds?.length) {
      throw new BadRequestException(
        'entityIds must contain at least one entity for an admin-created version',
      );
    }
    await this.assertPolicyEntityIdsExist(policy.entityIds, auth);

    if (
      !Number.isFinite(args.effectiveFrom.getTime()) ||
      (args.effectiveTo != null && !Number.isFinite(args.effectiveTo.getTime()))
    ) {
      throw new BadRequestException('invalid effective date');
    }
    if (
      args.effectiveTo != null &&
      args.effectiveTo.getTime() <= args.effectiveFrom.getTime()
    ) {
      throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }

    const version = args.version.trim();
    if (!version) throw new BadRequestException('topic version is required');
    try {
      const row = await this.prisma.topicVersion.create({
        data: {
          topicId: topic.id,
          version,
          effectiveFrom: args.effectiveFrom,
          effectiveTo: args.effectiveTo ?? null,
          policyJson: policy as unknown as Prisma.InputJsonValue,
        },
      });
      return toPlainJson(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `topic version already exists for ${topic.slug}: ${version}`,
        );
      }
      throw e;
    }
  }

  async seedDemo(slug = 'global-female-singers') {
    const defaultTenant = await this.prisma.tenant.upsert({
      where: { slug: 'default' },
      create: { slug: 'default', name: 'Default tenant' },
      update: {},
    });

    const topic = await this.prisma.topic.upsert({
      where: { slug },
      update: { title: 'Global female singers (demo)' },
      create: {
        slug,
        title: 'Global female singers (demo)',
        kind: 'SEMI_OBJECTIVE',
        locale: 'en',
        tenantId: defaultTenant.id,
      },
    });

    const policy: RankingPolicyJson = {
      weights: defaultWeights,
      requiredSignalKeys: ['streams', 'mentions', 'social'],
    };

    const version = await this.prisma.topicVersion.upsert({
      where: {
        topicId_version: { topicId: topic.id, version: '2026.05' },
      },
      update: { policyJson: policy as unknown as Prisma.InputJsonValue },
      create: {
        topicId: topic.id,
        version: '2026.05',
        effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
        policyJson: policy as unknown as Prisma.InputJsonValue,
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

    if (this.elastic.isEnabled() || this.qdrant.isEnabled()) {
      await this.prisma.$transaction(async (tx) => {
        for (const def of entityDefs) {
          const entity = await tx.entity.create({
            data: {
              type: 'PERSON',
              canonicalName: def.name,
              tenantId: defaultTenant.id,
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
            tenantId: defaultTenant.id,
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
        policyJson: { ...policy, entityIds } as unknown as Prisma.InputJsonValue,
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

  async listVersionsBySlug(slug: string, auth?: AuthenticatedRequestContext) {
    const topic = await this.prisma.topic.findFirst({
      where: { slug, ...topicWhereForAuth(auth) },
    });
    if (!topic) return [];
    await assertTopicAccessible(topic, auth);
    return this.prisma.topicVersion.findMany({
      where: { topicId: topic.id },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getTopicBySlug(slug: string, auth?: AuthenticatedRequestContext) {
    const s = slug.trim();
    const topic = await this.prisma.topic.findFirst({
      where: { slug: s, ...topicWhereForAuth(auth) },
      select: {
        id: true,
        slug: true,
        title: true,
        entityScope: true,
        kind: true,
        locale: true,
        metricPlan: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
        entityAutofill: true,
      },
    });
    if (!topic) throw new NotFoundException('topic not found');
    await assertTopicAccessible(topic, auth);
    return toPlainJson({
      id: topic.id.toString(),
      slug: topic.slug,
      title: topic.title,
      entityScope: topic.entityScope,
      kind: topic.kind,
      kindStrategy: topicKindStrategyPublic(topic.kind),
      locale: topic.locale,
      metricPlan: topic.metricPlan,
      tenantId: topic.tenantId?.toString() ?? null,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
      entityAutofill: publicEntityAutofill(topic.entityAutofill),
    });
  }

  async updateTopicBySlug(
    slug: string,
    patch: { kind?: TopicKind; title?: string; entityScope?: string },
    auth?: AuthenticatedRequestContext,
  ) {
    const s = slug.trim();
    const topic = await this.prisma.topic.findFirst({
      where: { slug: s, ...topicWhereForAuth(auth) },
    });
    if (!topic) throw new NotFoundException('topic not found');
    await assertTopicAccessible(topic, auth);

    const data: Prisma.TopicUpdateInput = {};
    if (patch.kind !== undefined) data.kind = patch.kind;
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('title must be non-empty');
      data.title = title;
    }
    if (patch.entityScope !== undefined) {
      const entityScope = patch.entityScope.trim();
      if (!entityScope) throw new BadRequestException('entityScope must be non-empty');
      data.entityScope = entityScope;
    }
    if (this.metricPlanning && (patch.title !== undefined || patch.kind !== undefined)) {
      const nextTitle = patch.title?.trim() || topic.title;
      const nextKind = patch.kind ?? topic.kind;
      data.metricPlan = await this.metricPlanning.suggest({
        title: nextTitle,
        kind: nextKind,
        locale: topic.locale,
      }) as unknown as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('no fields to update');
    }

    const updated = await this.prisma.topic.update({
      where: { id: topic.id },
      data,
      select: {
        id: true,
        slug: true,
        title: true,
        entityScope: true,
        kind: true,
        locale: true,
        metricPlan: true,
        tenantId: true,
        updatedAt: true,
      },
    });
    return toPlainJson({
      id: updated.id.toString(),
      slug: updated.slug,
      title: updated.title,
      entityScope: updated.entityScope,
      kind: updated.kind,
      locale: updated.locale,
      metricPlan: updated.metricPlan,
      tenantId: updated.tenantId?.toString() ?? null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  }

  async setTopicOnline(
    slug: string,
    isOnline: boolean,
    auth?: AuthenticatedRequestContext,
  ) {
    const topic = await this.prisma.topic.findFirst({
      where: { slug: slug.trim(), deletedAt: null, ...topicWhereForAuth(auth) },
      select: { id: true, tenantId: true },
    });
    if (!topic) throw new NotFoundException('topic not found');
    await assertTopicAccessible(topic, auth);
    const updated = await this.prisma.topic.update({
      where: { id: topic.id },
      data: { isOnline },
      select: { id: true, slug: true, isOnline: true, updatedAt: true },
    });
    return toPlainJson(updated);
  }

  async softDeleteTopic(
    slug: string,
    auth?: AuthenticatedRequestContext,
  ) {
    const topic = await this.prisma.topic.findFirst({
      where: { slug: slug.trim(), deletedAt: null, ...topicWhereForAuth(auth) },
      select: { id: true, tenantId: true },
    });
    if (!topic) throw new NotFoundException('topic not found');
    await assertTopicAccessible(topic, auth);
    const deletedAt = new Date();
    const updated = await this.prisma.topic.update({
      where: { id: topic.id },
      data: { isOnline: false, deletedAt },
      select: { id: true, slug: true, isOnline: true, deletedAt: true },
    });
    return toPlainJson(updated);
  }

  /** Cache immutable snapshot data; attach current AI statistics and redact only the response. */
  async getSnapshotForApi(
    id: bigint,
    opts?: { includeAiStats?: boolean; scopes?: ApiKeyScope[] },
  ): Promise<unknown | null> {
    let plain: unknown;
    const cached = await this.rankingCache.getSnapshotJson(id);
    if (cached) {
      try { plain = JSON.parse(cached); } catch { /* Reload corrupt entries. */ }
    }
    if (!plain) {
      const snapshot = await this.loadSnapshotFull(id);
      if (!snapshot) return null;
      plain = toPlainJson(snapshot);
      await this.rankingCache.setSnapshotJson(id, JSON.stringify(plain));
    }
    const payload = opts?.includeAiStats
      ? { ...(plain as Record<string, unknown>), ...await this.aiAnalysisQuickStatsForSnapshot(id) }
      : plain;
    if (opts?.scopes?.length) redactSnapshotPlainForScopes(payload, opts.scopes);
    return payload;
  }

  /** 带租户校验的快照 GET（API 密钥上下文） */
  async getSnapshotForApiWithAuth(
    id: bigint,
    opts?: { includeAiStats?: boolean; auth?: AuthenticatedRequestContext | null },
  ): Promise<unknown | null> {
    // Authorize with a small current row, not a second full snapshot/items load.
    const head = await this.prisma.topicRankSnapshot.findUnique({ where: { id }, select: {
      confidenceScore: true, trendSummary: true, generatedByAi: true,
      topicRanking: { select: { topicVersion: { select: { topic: { select: { tenantId: true } } } } } },
    } });
    if (!head) return null;
    await assertTopicAccessible(head.topicRanking.topicVersion.topic, opts?.auth);
    const payload = await this.getSnapshotForApi(id, { includeAiStats: opts?.includeAiStats, scopes: opts?.auth?.scopes ?? ['read'] });
    return payload ? { ...(payload as Record<string, unknown>), confidenceScore: head.confidenceScore, trendSummary: head.trendSummary, generatedByAi: head.generatedByAi } : null;
  }

  private snapshotInclude() {
    return {
      items: { include: { entity: true }, orderBy: { rank: 'asc' as const } },
      topicRanking: { include: { topicVersion: { include: { topic: true } } } },
      scoreModel: true,
    };
  }

  private async loadSnapshotFull(id: bigint) {
    return this.prisma.topicRankSnapshot.findUnique({
      where: { id },
      include: this.snapshotInclude(),
    });
  }

  /**
   * 法务/审计：按 `ScoreBreakdown` 关系表扁平导出（新物化快照；旧快照无行时 `rows` 为空）。
   */
  async getSnapshotRelationalScoreBreakdowns(snapshotId: bigint): Promise<unknown | null> {
    const snap = await this.prisma.topicRankSnapshot.findUnique({
      where: { id: snapshotId },
      include: { scoreModel: true },
    });
    if (!snap) return null;

    const breakdownRows = await this.prisma.scoreBreakdown.findMany({
      where: { item: { snapshotId: snapshotId } },
      include: {
        item: {
          select: {
            rank: true,
            entityId: true,
            entity: { select: { canonicalName: true } },
          },
        },
        model: true,
      },
    });

    breakdownRows.sort((a, b) => {
      const dr = a.item.rank - b.item.rank;
      if (dr !== 0) return dr;
      return a.component.localeCompare(b.component);
    });

    const scoreModelPlain =
      snap.scoreModel != null
        ? toPlainJson(snap.scoreModel)
        : breakdownRows[0]?.model != null
          ? toPlainJson(breakdownRows[0].model)
          : null;

    return toPlainJson({
      snapshotId: snap.id.toString(),
      scoreModel: scoreModelPlain,
      rowCount: breakdownRows.length,
      rows: breakdownRows.map((r) => ({
        rank: r.item.rank,
        entityId: r.item.entityId.toString(),
        canonicalName: r.item.entity.canonicalName,
        modelId: r.modelId.toString(),
        component: r.component,
        value: r.value,
        weight: r.weight,
        note: r.note,
      })),
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
   * 嵌套 `snapshot` 与 `GET /v1/snapshots/:id` 同源；可选 `includeAiStats` 时与快照 GET 一致合并简报统计（独立热榜缓存键）。
   */
  async getLeaderboardForApi(
    slug: string,
    query: {
      version?: string;
      timeWindow?: TimeWindow;
      windowStart?: string;
      includeAiStats?: boolean;
    },
    auth?: AuthenticatedRequestContext | null,
  ): Promise<unknown | null> {
    let context;
    try {
      context = await new TopicRankingQuery(this.prisma).resolve(slug, query, auth);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
    if (!context.snapshot) return null;
    const snapshot = await this.getSnapshotForApiWithAuth(context.snapshot.id, { auth, includeAiStats: query.includeAiStats });
    return snapshot ? { resolved: leaderboardResolved(context), snapshot } : null;
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
      await this.enqueuePostSnapshotFollowup(
        snapshot.id,
        topicRanking.id,
        topicVersion.id,
        topicVersion.topicId,
        args.timeWindow,
      );
      await this.emitSnapshotReadyEvent(snapshot, topicRanking, topicVersion);
      return this.serializeSnapshot(snapshot);
    } catch (err) {
      await this.prisma.topicRanking.update({
        where: { id: topicRanking.id },
        data: {
          status: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
      await this.emitRankingFailedEvent(topicRanking.id, topicVersion.id, err);
      throw err;
    }
  }

  /** 异步：入队，由 Worker 物化快照 */
  async enqueueRanking(args: RunRankingArgs): Promise<{
    jobId: string;
    topicRankingId: string;
    dedupedSnapshot?: boolean;
    snapshotId?: string;
    hasScoreModel?: boolean;
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
      await this.emitSnapshotReadyEvent(existingSnap, topicRanking, topicVersion, {
        deduped: true,
      });
      return {
        jobId: buildRankingJobId(this.toPayload(topicRanking.id, args)),
        topicRankingId: topicRanking.id.toString(),
        dedupedSnapshot: true,
        snapshotId: existingSnap.id.toString(),
        hasScoreModel: existingSnap.scoreModelId != null,
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
      await this.enqueuePostSnapshotFollowup(
        snap.id,
        topicRankingId,
        topicVersion.id,
        topicVersion.topicId,
        args.timeWindow,
      );
      await this.emitSnapshotReadyEvent(snap, topicRanking, topicVersion);
      return this.serializeSnapshot(snap);
    } catch (err) {
      await this.prisma.topicRanking.update({
        where: { id: topicRankingId },
        data: {
          status: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
      await this.emitRankingFailedEvent(topicRankingId, args.topicVersionId, err);
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

  /**
   * Phase B：物化成功后入队轻量 follow-up（与主排行解耦，便于挂摘要 / Agent DAG）。
   * `RANKING_FOLLOWUP_DISABLED=true` 时跳过入队。
   */
  private async enqueuePostSnapshotFollowup(
    snapshotId: bigint,
    topicRankingId: bigint,
    topicVersionId: bigint,
    topicId: bigint,
    timeWindow: TimeWindow,
  ): Promise<void> {
    if (process.env.RANKING_FOLLOWUP_DISABLED === 'true') {
      return;
    }
    const payload: RankingFollowupPayload = {
      schemaVersion: 1,
      snapshotId: snapshotId.toString(),
      topicRankingId: topicRankingId.toString(),
      topicVersionId: topicVersionId.toString(),
      topicId: topicId.toString(),
      timeWindow,
    };
    const jobId = buildRankingFollowupJobId(payload.snapshotId);
    try {
      await this.rankingFollowupQueue.add(RANKING_FOLLOWUP_JOB_NAME, payload, {
        jobId,
        removeOnComplete: 500,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists|duplicate/i.test(msg)) {
        this.logger.debug(`ranking followup job exists: ${jobId}`);
        return;
      }
      this.logger.warn(`ranking followup enqueue failed (${jobId}): ${msg}`);
    }
  }

  /** BullMQ `ranking-followup` Worker 处理函数 */
  async handleRankingFollowupJob(data: RankingFollowupPayload): Promise<Record<string, unknown>> {
    return this.agentOrchestration.runSnapshotPostProcessPipeline(data);
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

  private async assertPolicyEntityIdsExist(
    entityIds: string[],
    auth?: AuthenticatedRequestContext,
  ) {
    const unique = [...new Set(entityIds)];
    const ids = unique.map((s) => BigInt(s));
    const found = await this.prisma.entity.findMany({
      where: { id: { in: ids }, ...entityWhereForAuth(auth) },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      const ok = new Set(found.map((f) => f.id.toString()));
      const missing = unique.filter((id) => !ok.has(id));
      throw new BadRequestException(`unknown entity id(s): ${missing.join(', ')}`);
    }
  }

  /**
   * 校验并 PATCH `TopicVersion.policyJson`（`frozen` 为 true 时拒绝）。
   */
  async updateTopicVersionPolicy(topicVersionId: bigint, rawPolicy: unknown) {
    let policy: RankingPolicyJson;
    try {
      policy = parseRankingPolicyJson(rawPolicy);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'invalid policyJson',
      );
    }

    const row = await this.prisma.topicVersion.findUnique({
      where: { id: topicVersionId },
    });
    if (!row) throw new NotFoundException('topic version not found');
    if (row.frozen) {
      throw new BadRequestException('topic version is frozen');
    }

    if (policy.entityIds?.length) {
      await this.assertPolicyEntityIdsExist(policy.entityIds);
    }

    await this.assertEntitiesPresent({
      id: row.id,
      policyJson: policy,
    });

    const updated = await this.prisma.topicVersion.update({
      where: { id: topicVersionId },
      data: { policyJson: policy as unknown as Prisma.InputJsonValue },
    });

    return toPlainJson({
      id: updated.id.toString(),
      topicId: updated.topicId.toString(),
      version: updated.version,
      frozen: updated.frozen,
      effectiveFrom: updated.effectiveFrom.toISOString(),
      effectiveTo: updated.effectiveTo?.toISOString() ?? null,
      policyJson: updated.policyJson,
    });
  }

  private async resolveEntityIds(topicVersion: { policyJson: unknown }): Promise<bigint[]> {
    const policy = topicVersion.policyJson as unknown as RankingPolicyJson;
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
    const topicRow = await this.prisma.topic.findUnique({
      where: { id: topicVersion.topicId },
      select: { kind: true },
    });
    if (!topicRow) throw new BadRequestException('topic not found');

    let policy: RankingPolicyJson;
    try {
      policy = parseRankingPolicyJson(topicVersion.policyJson);
    } catch {
      policy = { weights: { ...defaultWeights } };
    }
    policy = mergePolicyWithTopicKind(topicRow.kind, policy);
    const weights = policy.weights;
    const decay = policy.decay;
    const requiredKeys = policy.requiredSignalKeys ?? Object.keys(weights);
    const required = new Set(requiredKeys);
    const kindPreset = topicKindPreset(topicRow.kind);
    const minCoverage = kindPreset.minCoverageToRank;

    let entityIds = await this.resolveEntityIds(topicVersion);
    if (entityIds.length === 0) throw new BadRequestException('no entities to rank');

    const metricsForFilter = await this.prisma.entityMetric.findMany({
      where: {
        entityId: { in: entityIds },
        observedAt: { lte: snapshotTime },
      },
    });
    const indexedForFilter = indexEntitySignals(metricsForFilter, entityIds, snapshotTime);
    const eligibleIds = indexedForFilter
      .filter((idx) =>
        entityHasRequiredSignals(idx.signalRows, [...required], snapshotTime),
      )
      .map((idx) => idx.entityId);
    const excludedBySignals = entityIds.length - eligibleIds.length;
    if (eligibleIds.length > 0) entityIds = eligibleIds;

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

    const indexed = indexEntitySignals(metrics, entityIds, snapshotTime);

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

    for (const idx of indexed) {
      const { entityId, signals, presentKeys } = idx;
      const coverage =
        required.size === 0
          ? 1
          : signalCoverage(presentKeys, [...required]);

      if (coverage < minCoverage) continue;

      const { total, breakdown } = scoreEntity(signals, weights, snapshotTime, decay);
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

    if (scored.length === 0) {
      throw new BadRequestException(
        `no entities meet TopicKind ${topicRow.kind} signal requirements (minCoverage=${minCoverage})`,
      );
    }

    const rankRows = scored
      .map((s, i) => ({ s, n: normalizedTotals[i] }))
      .sort((a, b) => b.n - a.n);

    const kindStrategyMeta = {
      ...topicKindStrategyPublic(topicRow.kind),
      appliedWeights: weights,
      appliedDecay: decay,
      excludedByMissingSignals: excludedBySignals,
      rankedEntityCount: rankRows.length,
    };

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
        weights,
        kindStrategyMeta,
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

  private async resolveOrCreateScoreModel(
    tx: Prisma.TransactionClient,
    topicVersion: { id: bigint; version: string },
    weights: Record<string, number>,
  ) {
    const name = `topicVersion:${topicVersion.id.toString()}`;
    const version = `${topicVersion.version}#${stableWeightsFingerprint(weights)}`;
    const existing = await tx.scoreModel.findFirst({
      where: { name, version },
    });
    if (existing) return existing;
    return tx.scoreModel.create({
      data: {
        name,
        version,
        weights: weights as Prisma.InputJsonValue,
      },
    });
  }

  private async persistSnapshotTransaction(
    topicRankingId: bigint,
    topicVersion: { id: bigint; topicId: bigint; version: string },
    args: RunRankingArgs,
    snapshotTime: Date,
    snapshotVersion: string,
    itemsCreate: Prisma.RankingItemCreateWithoutSnapshotInput[],
    weights: Record<string, number>,
    kindStrategyMeta?: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const scoreModel = await this.resolveOrCreateScoreModel(tx, topicVersion, weights);

      const snap = await tx.topicRankSnapshot.create({
        data: {
          topicRankingId,
          snapshotTime,
          snapshotVersion,
          rankingJson: { note: 'initial' } as Prisma.InputJsonValue,
          trendSummary: null,
          generatedByAi: false,
          confidenceScore: 0,
          scoreModelId: scoreModel.id,
          items: { create: itemsCreate },
        },
        include: { items: { orderBy: { rank: 'asc' } } },
      });

      const breakdownRows: Prisma.ScoreBreakdownCreateManyInput[] = [];
      for (const it of snap.items) {
        const rec = parseScoreBreakdownJson(it.scoreBreakdown);
        if (!rec) continue;
        for (const [component, value] of Object.entries(rec)) {
          const w = weights[component];
          breakdownRows.push({
            modelId: scoreModel.id,
            rankingItemId: it.id,
            component,
            value,
            weight: typeof w === 'number' && Number.isFinite(w) ? w : 0,
          });
        }
      }
      if (breakdownRows.length > 0) {
        await tx.scoreBreakdown.createMany({ data: breakdownRows });
      }

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
            kindStrategy: kindStrategyMeta ?? null,
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

      await upsertEntityTopicStatsBatch(
        tx,
        topicVersion.topicId,
        args.timeWindow,
        snapshotTime,
        snap.items.map((it) => ({ entityId: it.entityId, rank: it.rank })),
      );

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
          payload: buildRankingSnapshotCompletedOutboxPayload({
            snapshotId: snap.id,
            topicRankingId,
            topicVersionId: topicVersion.id,
            topicId: topicVersion.topicId,
            topicVersionLabel: topicVersion.version,
            timeWindow: args.timeWindow,
            snapshotTime,
            snapshotVersion,
            itemCount: snap.items.length,
            confidenceScore: confAvg,
            scoreModelId: snap.scoreModelId,
          }),
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
            payload: buildClickhouseRankingSnapshotOutboxPayload({
              snapshotId: snap.id,
            }),
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
    auth?: AuthenticatedRequestContext,
  ) {
    const s = slug.trim();
    const topic = await this.prisma.topic.findFirst({
      where: { slug: s, ...topicWhereForAuth(auth) },
      select: { id: true, slug: true, title: true, tenantId: true },
    });
    if (!topic) throw new NotFoundException('topic not found');
    await assertTopicAccessible(topic, auth);

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

  private async distinctSnapshotIdsMatchingAnalysis(
    snapshotIds: bigint[],
    agent: string,
    agentKind: string,
  ): Promise<Set<string>> {
    const out = new Set<string>();
    if (snapshotIds.length === 0) return out;
    const rows = await this.prisma.aiAnalysis.findMany({
      where: {
        snapshotId: { in: snapshotIds },
        OR: [
          { agent },
          {
            detailJson: {
              path: ['agentKind'],
              equals: agentKind,
            },
          },
        ],
      },
      distinct: ['snapshotId'],
      select: { snapshotId: true },
    });
    for (const r of rows) {
      out.add(r.snapshotId.toString());
    }
    return out;
  }

  private async aiAnalysisQuickStatsForSnapshot(snapshotId: bigint): Promise<{
    aiAnalysisCount: number;
  } & Record<AiAnalysisBriefField, boolean>> {
    const sid = snapshotId.toString();
    const [aiAnalysisCount, ...briefSets] = await Promise.all([
      this.prisma.aiAnalysis.count({ where: { snapshotId } }),
      ...AI_ANALYSIS_BRIEF_SPECS.map((spec) =>
        this.distinctSnapshotIdsMatchingAnalysis(
          [snapshotId],
          spec.agent,
          spec.agentKind,
        ),
      ),
    ]);
    const briefs = {} as Record<AiAnalysisBriefField, boolean>;
    for (let i = 0; i < AI_ANALYSIS_BRIEF_SPECS.length; i++) {
      briefs[AI_ANALYSIS_BRIEF_SPECS[i].field] = briefSets[i].has(sid);
    }
    return { aiAnalysisCount, ...briefs };
  }

  private async loadBriefFlagsForSnapshots(
    snapshotIds: bigint[],
  ): Promise<Record<AiAnalysisBriefField, Set<string>>> {
    const out = {} as Record<AiAnalysisBriefField, Set<string>>;
    if (snapshotIds.length === 0) {
      for (const spec of AI_ANALYSIS_BRIEF_SPECS) {
        out[spec.field] = new Set();
      }
      return out;
    }
    const sets = await Promise.all(
      AI_ANALYSIS_BRIEF_SPECS.map((spec) =>
        this.distinctSnapshotIdsMatchingAnalysis(
          snapshotIds,
          spec.agent,
          spec.agentKind,
        ),
      ),
    );
    for (let i = 0; i < AI_ANALYSIS_BRIEF_SPECS.length; i++) {
      out[AI_ANALYSIS_BRIEF_SPECS[i].field] = sets[i];
    }
    return out;
  }

  private aiBriefStatsForSnapshot(
    sid: string,
    briefFlags: Record<AiAnalysisBriefField, Set<string>>,
  ): Record<AiAnalysisBriefField, boolean> {
    const out = {} as Record<AiAnalysisBriefField, boolean>;
    for (const spec of AI_ANALYSIS_BRIEF_SPECS) {
      out[spec.field] = briefFlags[spec.field].has(sid);
    }
    return out;
  }

  /**
   * 某话题下近期物化的排行榜快照（跨 `TopicVersion` / `TopicRanking`）。
   */
  async listSnapshotsForTopicSlug(
    slug: string,
    timeWindow?: TimeWindow,
    limit = 30,
    auth?: AuthenticatedRequestContext,
  ) {
    const s = slug.trim();
    const topic = await this.prisma.topic.findFirst({
      where: { slug: s, ...topicWhereForAuth(auth) },
      select: { id: true, slug: true, title: true, tenantId: true },
    });
    if (!topic) throw new NotFoundException('topic not found');
    await assertTopicAccessible(topic, auth);

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
        scoreModelId: true,
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

    const snapshotIds = rows.map((r) => r.id);
    const analysisCountBySnapshot = new Map<string, number>();
    let briefFlags = {} as Record<AiAnalysisBriefField, Set<string>>;

    if (snapshotIds.length > 0) {
      const countAgg = await this.prisma.aiAnalysis.groupBy({
        by: ['snapshotId'],
        where: { snapshotId: { in: snapshotIds } },
        _count: { _all: true },
      });
      for (const c of countAgg) {
        analysisCountBySnapshot.set(c.snapshotId.toString(), c._count._all);
      }

      briefFlags = await this.loadBriefFlagsForSnapshots(snapshotIds);
    }

    return toPlainJson({
      topic: {
        id: topic.id.toString(),
        slug: topic.slug,
        title: topic.title,
      },
      filter: { timeWindow: timeWindow ?? null, limit: take },
      count: rows.length,
      snapshots: rows.map((r) => {
        const sid = r.id.toString();
        return {
          id: sid,
          snapshotTime: r.snapshotTime.toISOString(),
          snapshotVersion: r.snapshotVersion,
          confidenceScore: r.confidenceScore,
          generatedByAi: r.generatedByAi,
          topicRankingId: r.topicRankingId.toString(),
          aiAnalysisCount: analysisCountBySnapshot.get(sid) ?? 0,
          ...this.aiBriefStatsForSnapshot(sid, briefFlags),
          hasScoreModel: r.scoreModelId != null,
          topicRanking: {
            id: r.topicRanking.id.toString(),
            timeWindow: r.topicRanking.timeWindow,
            windowStart: r.topicRanking.windowStart.toISOString(),
            windowEnd: r.topicRanking.windowEnd.toISOString(),
            status: r.topicRanking.status,
            topicVersionId: r.topicRanking.topicVersion.id.toString(),
            topicVersionLabel: r.topicRanking.topicVersion.version,
          },
        };
      }),
    });
  }

  /**
   * 从近期快照级 `TrendAnalysis` 的 `topRankGainers` 聚合「涨名次」热度（演示级只读）。
   */
  async listHotTrends(timeWindow?: TimeWindow, limit = 15) {
    const take = Math.min(Math.max(limit, 1), 50);
    const scan = 120;
    const rows = await this.readPrisma.trendAnalysis.findMany({
      where: {
        entityId: null,
        ...(timeWindow ? { window: timeWindow } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: scan,
      select: {
        topicId: true,
        window: true,
        createdAt: true,
        payload: true,
      },
    });

    const topicIdStrs = [...new Set(rows.map((r) => r.topicId.toString()))];
    const topicIds = topicIdStrs.map((s) => BigInt(s));
    const topics =
      topicIds.length === 0
        ? []
        : await this.readPrisma.topic.findMany({
            where: { id: { in: topicIds } },
            select: { id: true, slug: true, title: true },
          });
    const topicById = new Map(topics.map((t) => [t.id.toString(), t]));

    type Acc = {
      canonicalName: string;
      totalRankGain: number;
      mentions: number;
      topicSlugs: string[];
    };
    const agg = new Map<string, Acc>();

    for (const r of rows) {
      const payload = r.payload as Record<string, unknown>;
      if (payload?.kind !== 'snapshot_summary') continue;
      const gainers = payload.topRankGainers;
      if (!Array.isArray(gainers)) continue;
      const tInfo = topicById.get(r.topicId.toString());
      const slug = tInfo?.slug ?? r.topicId.toString();

      for (const g of gainers) {
        if (typeof g !== 'object' || g === null) continue;
        const o = g as Record<string, unknown>;
        const eid = o.entityId != null ? String(o.entityId) : '';
        const name = o.canonicalName != null ? String(o.canonicalName) : '';
        const rc =
          typeof o.rankChange === 'number' ? o.rankChange : Number(o.rankChange);
        if (!eid || !Number.isFinite(rc) || rc <= 0) continue;

        let acc = agg.get(eid);
        if (!acc) {
          acc = {
            canonicalName: name,
            totalRankGain: 0,
            mentions: 0,
            topicSlugs: [],
          };
          agg.set(eid, acc);
        }
        acc.totalRankGain += rc;
        acc.mentions += 1;
        if (name && !acc.canonicalName) acc.canonicalName = name;
        if (!acc.topicSlugs.includes(slug)) acc.topicSlugs.push(slug);
      }
    }

    const items = [...agg.entries()]
      .map(([entityId, v]) => ({
        entityId,
        canonicalName: v.canonicalName || entityId,
        totalRankGain: v.totalRankGain,
        mentions: v.mentions,
        topicSlugs: v.topicSlugs,
      }))
      .sort((a, b) => b.totalRankGain - a.totalRankGain)
      .slice(0, take);

    return toPlainJson({
      filter: { timeWindow: timeWindow ?? null, limit: take },
      source: {
        analysesScanned: rows.length,
        note:
          'Aggregated from recent snapshot-level TrendAnalysis payloads (topRankGainers rank change).',
      },
      items,
    });
  }

  /**
   * C 端只读热榜索引：返回有快照的话题及其最新榜 TOP N 预览。
   */
  async listHotBoards(
    opts: {
      topicsLimit?: number;
      previewLimit?: number;
      timeWindow?: TimeWindow;
      offset?: number;
      topicQuery?: string;
      topicKind?: TopicKind;
    } = {},
    auth?: AuthenticatedRequestContext,
  ) {
    const topicsLimit = Math.min(Math.max(opts.topicsLimit ?? 12, 1), 30);
    const previewLimit = Math.min(Math.max(opts.previewLimit ?? 5, 1), 20);
    const offset = Math.min(Math.max(opts.offset ?? 0, 0), 500);
    const topicQuery = opts.topicQuery?.trim();

    const topicWhere: Prisma.TopicWhereInput = {
      ...topicWhereForAuth(auth),
      ...(opts.topicKind ? { kind: opts.topicKind } : {}),
      ...(topicQuery
        ? {
            OR: [
              { slug: { contains: topicQuery, mode: 'insensitive' } },
              { title: { contains: topicQuery, mode: 'insensitive' } },
            ],
          }
        : {}),
      versions: {
        some: {
          rankings: {
            some: {
              status: 'completed',
              snapshots: { some: {} },
              ...(opts.timeWindow ? { timeWindow: opts.timeWindow } : {}),
            },
          },
        },
      },
    };

    // Batched relation projection: only the requested preview and count, not full snapshots.
    const [totalMatching, topics] = await Promise.all([
      this.readPrisma.topic.count({ where: topicWhere }),
      this.readPrisma.topic.findMany({
        where: topicWhere, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: offset, take: topicsLimit + 12,
        select: { id: true, slug: true, title: true, kind: true, tenantId: true,
          versions: { orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, version: true,
            rankings: { where: { status: 'completed', snapshots: { some: {} }, ...(opts.timeWindow ? { timeWindow: opts.timeWindow } : {}) },
              orderBy: [{ windowStart: 'desc' }, { id: 'desc' }], take: 1,
              select: { id: true, timeWindow: true, windowStart: true, windowEnd: true,
                snapshots: { orderBy: [{ snapshotTime: 'desc' }, { id: 'desc' }], take: 1,
                  select: { id: true, snapshotTime: true, scoreModelId: true, _count: { select: { items: true } },
                    items: { orderBy: { rank: 'asc' }, take: previewLimit,
                      select: { rank: true, rankChange: true, popularityScore: true, entity: { select: { id: true, canonicalName: true, piiLevel: true } } } },
                  },
                },
              },
            },
          } },
        },
      }),
    ]);
    const boards = [];
    let scanned = 0;
    for (const topic of topics) {
      if (boards.length >= topicsLimit) break;
      scanned++;
      const version = topic.versions[0], ranking = version?.rankings[0], snap = ranking?.snapshots[0];
      if (!snap?.items.length || !version || !ranking) continue;
      boards.push({ topic: { id: String(topic.id), slug: topic.slug, title: topic.title, kind: topic.kind },
        resolved: { topicSlug: topic.slug, topicTitle: topic.title, topicVersionId: String(version.id), version: version.version,
          topicRankingId: String(ranking.id), timeWindow: ranking.timeWindow, windowStart: ranking.windowStart.toISOString(), windowEnd: ranking.windowEnd.toISOString(),
          snapshotId: String(snap.id), snapshotTime: snap.snapshotTime.toISOString(), hasScoreModel: snap.scoreModelId != null,
          ...(ranking.timeWindow === 'REALTIME' ? { realtimeSemantics: resolveRealtimeRankingWindow(ranking.windowEnd).semantics } : {}),
        },
        snapshot: { id: String(snap.id), snapshotTime: snap.snapshotTime.toISOString(), itemCount: snap._count.items,
          preview: snap.items.map(row => ({ rank: row.rank, rankChange: row.rankChange, popularityScore: row.popularityScore,
            entity: { id: String(row.entity.id), canonicalName: redactEntityRecord(row.entity, auth?.scopes ?? ['read']).canonicalName } })),
        },
      });
    }
    const nextOffset = offset + scanned;
    return toPlainJson({
      filter: {
        topicsLimit,
        previewLimit,
        timeWindow: opts.timeWindow ?? null,
        offset,
        topicQuery: topicQuery || null,
        topicKind: opts.topicKind ?? null,
      },
      pagination: {
        offset,
        count: boards.length,
        totalMatching,
        hasMore: scanned > 0 && nextOffset < totalMatching,
        nextOffset: scanned > 0 && nextOffset < totalMatching ? nextOffset : null,
      },
      count: boards.length,
      boards,
      generatedAt: new Date().toISOString(),
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
    auth?: AuthenticatedRequestContext,
  ) {
    const slug = topicSlug.trim();
    const topic = await this.prisma.topic.findFirst({
      where: { slug, ...topicWhereForAuth(auth) },
    });
    if (!topic) throw new NotFoundException('topic not found');
    await assertTopicAccessible(topic, auth);
    const entity = await this.prisma.entity.findFirst({
      where: { id: entityId, ...entityWhereForAuth(auth) },
      select: { id: true, canonicalName: true, type: true, piiLevel: true },
    });
    if (!entity) throw new NotFoundException('entity not found');

    const take = Math.min(Math.max(limit, 1), 500);
    const rowsDesc = await this.readPrisma.rankingItemHistory.findMany({
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

    const twForStats = timeWindow ?? points[0]?.timeWindow;
    const stats = twForStats ? await this.readPrisma.entityTopicStats.findUnique({ where: {
      entityId_topicId_timeWindow: { entityId, topicId: topic.id, timeWindow: twForStats },
    } }) : null;
    const summary = rankingHistorySummary(points, stats);
    return toPlainJson({
      entity: {
        id: entity.id.toString(),
        canonicalName: redactEntityRecord(entity, auth?.scopes ?? ['read']).canonicalName,
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
  async compareSnapshots(rawIds: bigint[], includeAiStats?: boolean) {
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
          scoreBreakdown?: Record<string, number>;
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
        const breakdown = parseScoreBreakdownJson(it.scoreBreakdown);
        row.bySnapshot[sid] = {
          rank: it.rank,
          popularityScore: it.popularityScore,
          rankChange: it.rankChange,
          ...(breakdown ? { scoreBreakdown: breakdown } : {}),
        };
      }
    }

    const firstSid = ordered[0].id.toString();
    const rows = Array.from(entityMap.values()).sort((a, b) => {
      const rA = a.bySnapshot[firstSid]?.rank ?? 99999;
      const rB = b.bySnapshot[firstSid]?.rank ?? 99999;
      return rA - rB;
    });

    const statsList = includeAiStats
      ? await Promise.all(ordered.map((s) => this.aiAnalysisQuickStatsForSnapshot(s.id)))
      : null;

    return {
      topicRankingId: topicRankingId.toString(),
      snapshots: ordered.map((s, i) => ({
        id: s.id.toString(),
        snapshotTime: s.snapshotTime.toISOString(),
        snapshotVersion: s.snapshotVersion,
        hasScoreModel: s.scoreModelId != null,
        ...(statsList ? statsList[i] : {}),
      })),
      rowCount: rows.length,
      rows,
    };
  }

  private serializeSnapshot(s: TopicRankSnapshot & { items: unknown }) {
    return toRankingSnapshotPlainJson(s);
  }
}
