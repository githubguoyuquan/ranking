import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClickhouseService } from '../analytics/clickhouse.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReadService } from '../scale/prisma-read.service';
import { RankingsService } from '../rankings/rankings.service';
import { RedisHealthService } from '../cache/redis-health.service';
import { ElasticService } from '../search/elastic.service';
import { QdrantSearchService } from '../search/qdrant-search.service';
import { resolveSearchPrimary } from '../search/search-primary';

@Injectable()
export class BiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readPrisma: PrismaReadService,
    private readonly rankings: RankingsService,
    private readonly clickhouse: ClickhouseService,
    private readonly kafka: KafkaProducerService,
    private readonly redisHealth: RedisHealthService,
    private readonly elastic: ElasticService,
    private readonly qdrant: QdrantSearchService,
  ) {}

  async getTopicTimeseries(days: number) {
    const rows = await this.clickhouse.queryTopicPopularityTrend(days);
    return { ok: this.clickhouse.isEnabled(), days, rows };
  }

  async getEntityRankSparkline(entityId: bigint, days: number) {
    const rows = await this.clickhouse.queryEntityRankSparkline(entityId, days);
    return { ok: this.clickhouse.isEnabled(), entityId: entityId.toString(), days, rows };
  }

  async getOverview(chartDays = 14): Promise<Record<string, unknown>> {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const since24h = new Date(now.getTime() - 86_400_000);
    const since14d = new Date(now.getTime() - 14 * 86_400_000);

    const [
      topics,
      entities,
      snapshotsTotal,
      snapshotsLast24h,
      outboxPending,
      rankingsByStatus,
      crawlTasksRecent,
      aiAnalysesToday,
      snapshotsByDay,
      trendTypeRows,
      recentSnapshots,
      hotPayload,
      crawlByStatus,
      crawlByRegion,
      outboxByType,
      scheduleEnabledSources,
      scheduleRuns24h,
      dbPing,
      redisPing,
      chPing,
      kafkaStatus,
      esHealth,
      chTopicTrend,
    ] = await Promise.all([
      this.prisma.topic.count(),
      this.prisma.entity.count(),
      this.prisma.topicRankSnapshot.count(),
      this.prisma.topicRankSnapshot.count({
        where: { snapshotTime: { gte: since24h } },
      }),
      this.prisma.outboxEvent.count({ where: { publishedAt: null } }),
      this.prisma.topicRanking.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.crawlTask.count({
        where: { createdAt: { gte: since24h } },
      }),
      this.prisma.aiAnalysis.count({
        where: { createdAt: { gte: dayStart } },
      }),
      this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "snapshotTime" AT TIME ZONE 'UTC') AS day,
               COUNT(*)::bigint AS count
        FROM "TopicRankSnapshot"
        WHERE "snapshotTime" >= ${since14d}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      this.prisma.$queryRaw<{ trendType: string; count: bigint }[]>`
        SELECT ri."trendType"::text AS "trendType", COUNT(*)::bigint AS count
        FROM "RankingItem" ri
        INNER JOIN "TopicRankSnapshot" s ON s.id = ri."snapshotId"
        WHERE s."snapshotTime" >= ${since24h}
        GROUP BY 1
        ORDER BY count DESC
      `,
      this.prisma.topicRankSnapshot.findMany({
        orderBy: { snapshotTime: 'desc' },
        take: 12,
        select: {
          id: true,
          snapshotTime: true,
          confidenceScore: true,
          generatedByAi: true,
          topicRanking: {
            select: {
              timeWindow: true,
              status: true,
              topicVersion: {
                select: {
                  version: true,
                  topic: { select: { slug: true, title: true, kind: true } },
                },
              },
            },
          },
          _count: { select: { items: true, analyses: true } },
        },
      }),
      this.rankings.listHotTrends(undefined, 10),
      this.prisma.crawlTask.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since24h } },
        _count: { id: true },
      }),
      this.prisma.$queryRaw<{ region: string | null; count: bigint }[]>`
        SELECT COALESCE(region, 'global') AS region, COUNT(*)::bigint AS count
        FROM "Source"
        GROUP BY 1
        ORDER BY count DESC
      `,
      this.prisma.$queryRaw<{ type: string; count: bigint }[]>`
        SELECT type, COUNT(*)::bigint AS count
        FROM "OutboxEvent"
        WHERE "publishedAt" IS NULL
        GROUP BY type
        ORDER BY count DESC
        LIMIT 20
      `,
      this.prisma.source.count({ where: { scheduleEnabled: true } }),
      this.prisma.crawlScheduleRun.count({
        where: { scheduledAt: { gte: since24h } },
      }),
      this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT 1 AS n`),
      this.redisHealth.ping(),
      this.clickhouse.ping(),
      this.kafka.ping(),
      this.elastic.ping(),
      this.clickhouse.queryTopicPopularityTrend(chartDays),
    ]);

    const rankingQueue = Object.fromEntries(
      rankingsByStatus.map((r) => [r.status, r._count.id]),
    );

    const primarySearch = resolveSearchPrimary(this.qdrant, this.elastic);

    return toPlainJson({
      generatedAt: now.toISOString(),
      kpis: {
        topics,
        entities,
        snapshotsTotal,
        snapshotsLast24h,
        outboxPending,
        crawlTasksLast24h: crawlTasksRecent,
        aiAnalysesToday,
        rankingQueue,
        scheduleEnabledSources,
        scheduleRuns24h,
        searchPrimary: primarySearch,
      },
      health: {
        postgresql: { ok: dbPing[0]?.n === 1 },
        redis: redisPing,
        clickhouse: chPing,
        kafka: kafkaStatus,
        elasticsearch: esHealth,
      },
      crawlGlobal: {
        scheduler: {
          enabled: process.env.CRAWL_SCHEDULER_DISABLED !== 'true',
          region: process.env.CRAWL_SCHEDULER_REGION?.trim() || null,
          enabledSources: scheduleEnabledSources,
          runsLast24h: scheduleRuns24h,
        },
        tasksByStatus: Object.fromEntries(
          crawlByStatus.map((r) => [r.status, r._count.id]),
        ),
        sourcesByRegion: crawlByRegion.map((r) => ({
          region: r.region ?? 'global',
          count: Number(r.count),
        })),
      },
      searchScale: {
        primary: primarySearch,
        elasticsearch: this.elastic.scaleHints(),
        qdrantConfigured: this.qdrant.isEnabled(),
      },
      charts: {
        snapshotsByDay: snapshotsByDay.map((r) => ({
          day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
          count: Number(r.count),
        })),
        trendTypeMix: trendTypeRows.map((r) => ({
          trendType: r.trendType,
          count: Number(r.count),
        })),
        clickhouseTopicPopularity: chTopicTrend,
        outboxPendingByType: outboxByType.map((r) => ({
          type: r.type,
          count: Number(r.count),
        })),
      },
      hotMovers: (hotPayload as { items?: unknown }).items ?? [],
      recentSnapshots: recentSnapshots.map((s) => ({
        snapshotId: s.id.toString(),
        snapshotTime: s.snapshotTime.toISOString(),
        confidenceScore: s.confidenceScore,
        generatedByAi: s.generatedByAi,
        itemCount: s._count.items,
        aiAnalysisCount: s._count.analyses,
        timeWindow: s.topicRanking.timeWindow,
        rankingStatus: s.topicRanking.status,
        topicSlug: s.topicRanking.topicVersion.topic.slug,
        topicTitle: s.topicRanking.topicVersion.topic.title,
        topicKind: s.topicRanking.topicVersion.topic.kind,
        version: s.topicRanking.topicVersion.version,
      })),
    }) as Record<string, unknown>;
  }
}
