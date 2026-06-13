import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TimeWindow } from '@prisma/client';
import { diffTopicVersionPolicies } from '../domain/topic-version-diff';
import { parseRankingPolicyJson } from '../domain/policy-json';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReadService } from '../scale/prisma-read.service';

export type EntityTimelineEvent = {
  type: 'rank' | 'metric';
  at: string;
  topicSlug?: string;
  topicId?: string;
  label: string;
  meta: Record<string, unknown>;
};

@Injectable()
export class OpsAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readPrisma: PrismaReadService,
  ) {}

  async getEntityTimeline(
    entityId: bigint,
    opts: {
      topicSlugs?: string[];
      timeWindow?: TimeWindow;
      topicsLimit?: number;
      pointsLimit?: number;
      metricsLimit?: number;
    } = {},
  ) {
    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true, canonicalName: true, type: true },
    });
    if (!entity) throw new NotFoundException('entity not found');

    const topicsLimit = Math.min(Math.max(opts.topicsLimit ?? 5, 1), 10);
    const pointsLimit = Math.min(Math.max(opts.pointsLimit ?? 40, 1), 200);
    const metricsLimit = Math.min(Math.max(opts.metricsLimit ?? 30, 1), 100);

    const slugFilter = opts.topicSlugs?.map((s) => s.trim()).filter(Boolean) ?? [];
    let topicFilterIds: bigint[] | undefined;
    if (slugFilter.length > 0) {
      const topics = await this.prisma.topic.findMany({
        where: { slug: { in: slugFilter } },
        select: { id: true, slug: true },
      });
      topicFilterIds = topics.map((t) => t.id);
      if (topicFilterIds.length === 0) {
        throw new BadRequestException('no topics matched topicSlugs filter');
      }
    }

    const historyWhere = {
      entityId,
      ...(opts.timeWindow ? { timeWindow: opts.timeWindow } : {}),
      ...(topicFilterIds ? { topicId: { in: topicFilterIds } } : {}),
    };

    const topicCountsRaw = await this.readPrisma.rankingItemHistory.groupBy({
      by: ['topicId'],
      where: historyWhere,
      _count: { _all: true },
    });
    const topicCounts = topicCountsRaw
      .slice()
      .sort((a, b) => {
        const ca =
          typeof a._count === 'object' && a._count != null && '_all' in a._count
            ? (a._count._all ?? 0)
            : 0;
        const cb =
          typeof b._count === 'object' && b._count != null && '_all' in b._count
            ? (b._count._all ?? 0)
            : 0;
        return cb - ca;
      })
      .slice(0, topicsLimit);

    const topicIds = topicCounts.map((r) => r.topicId);
    const topics =
      topicIds.length === 0
        ? []
        : await this.prisma.topic.findMany({
            where: { id: { in: topicIds } },
            select: { id: true, slug: true, title: true },
          });
    const topicById = new Map(topics.map((t) => [t.id.toString(), t]));

    const statsRows =
      topicIds.length === 0
        ? []
        : await this.readPrisma.entityTopicStats.findMany({
            where: {
              entityId,
              topicId: { in: topicIds },
              ...(opts.timeWindow ? { timeWindow: opts.timeWindow } : {}),
            },
          });
    const statsByTopic = new Map(
      statsRows.map((s) => [`${s.topicId.toString()}:${s.timeWindow}`, s]),
    );

    const series: Array<{
      topicId: string;
      topicSlug: string;
      topicTitle: string;
      pointCount: number;
      timeWindow: TimeWindow | null;
      summary: Record<string, unknown> | null;
      points: Array<{
        asOf: string;
        rank: number;
        score: number;
        snapshotId: string;
        timeWindow: TimeWindow;
      }>;
    }> = [];

    const events: EntityTimelineEvent[] = [];

    for (const tc of topicCounts) {
      const topic = topicById.get(tc.topicId.toString());
      if (!topic) continue;

      const rows = await this.readPrisma.rankingItemHistory.findMany({
        where: {
          entityId,
          topicId: tc.topicId,
          ...(opts.timeWindow ? { timeWindow: opts.timeWindow } : {}),
        },
        orderBy: { asOf: 'desc' },
        take: pointsLimit,
        select: {
          asOf: true,
          rank: true,
          score: true,
          snapshotId: true,
          timeWindow: true,
        },
      });
      const pointsAsc = rows.slice().reverse();
      const tw = opts.timeWindow ?? rows[0]?.timeWindow ?? null;
      const statsKey = tw ? `${tc.topicId.toString()}:${tw}` : null;
      const stats = statsKey ? statsByTopic.get(statsKey) : undefined;

      const points = pointsAsc.map((p) => ({
        asOf: p.asOf.toISOString(),
        rank: p.rank,
        score: p.score,
        snapshotId: p.snapshotId.toString(),
        timeWindow: p.timeWindow,
      }));

      for (const p of points) {
        events.push({
          type: 'rank',
          at: p.asOf,
          topicId: topic.id.toString(),
          topicSlug: topic.slug,
          label: `${topic.slug} 名次 #${p.rank}`,
          meta: {
            rank: p.rank,
            score: p.score,
            snapshotId: p.snapshotId,
            timeWindow: p.timeWindow,
          },
        });
      }

      series.push({
        topicId: topic.id.toString(),
        topicSlug: topic.slug,
        topicTitle: topic.title,
        pointCount:
          typeof tc._count === 'object' && tc._count != null && '_all' in tc._count
            ? (tc._count._all ?? 0)
            : 0,
        timeWindow: tw,
        summary: stats
          ? {
              bestRank: stats.bestRank,
              worstRank: stats.worstRank,
              currentStreakUp: stats.currentStreakUp,
              currentStreakDown: stats.currentStreakDown,
              lastRank: stats.lastRank,
              lastAsOf: stats.lastAsOf?.toISOString() ?? null,
              materialized: true,
            }
          : null,
        points,
      });
    }

    const metrics = await this.prisma.entityMetric.findMany({
      where: { entityId },
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: metricsLimit,
    });

    for (const m of metrics) {
      events.push({
        type: 'metric',
        at: m.observedAt.toISOString(),
        label: `信号 ${m.metricKey} = ${m.value}`,
        meta: {
          metricKey: m.metricKey,
          value: m.value,
          unit: m.unit,
          sourceTier: m.sourceTier,
        },
      });
    }

    events.sort((a, b) => b.at.localeCompare(a.at));

    return toPlainJson({
      entity: {
        id: entity.id.toString(),
        canonicalName: entity.canonicalName,
        type: entity.type,
      },
      generatedAt: new Date().toISOString(),
      filter: {
        topicSlugs: slugFilter.length ? slugFilter : null,
        timeWindow: opts.timeWindow ?? null,
        topicsLimit,
        pointsLimit,
        metricsLimit,
      },
      topicSeries: series,
      metrics: metrics.map((m) => ({
        id: m.id.toString(),
        metricKey: m.metricKey,
        value: m.value,
        unit: m.unit,
        sourceTier: m.sourceTier,
        observedAt: m.observedAt.toISOString(),
      })),
      events: events.slice(0, 150),
      eventCount: events.length,
    });
  }

  async compareTopicVersions(
    fromId: bigint,
    toId: bigint,
    opts: { includeRankPreview?: boolean; timeWindow?: TimeWindow } = {},
  ) {
    if (fromId === toId) {
      throw new BadRequestException('from and to topic version must differ');
    }

    const versions = await this.prisma.topicVersion.findMany({
      where: { id: { in: [fromId, toId] } },
      include: { topic: { select: { id: true, slug: true, title: true, kind: true } } },
    });
    if (versions.length !== 2) {
      throw new BadRequestException('one or both topic versions not found');
    }

    const fromVer = versions.find((v) => v.id === fromId)!;
    const toVer = versions.find((v) => v.id === toId)!;
    if (fromVer.topicId !== toVer.topicId) {
      throw new BadRequestException('topic versions must belong to the same topic');
    }

    let fromPolicy;
    let toPolicy;
    try {
      fromPolicy = parseRankingPolicyJson(fromVer.policyJson);
      toPolicy = parseRankingPolicyJson(toVer.policyJson);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'invalid policyJson on topic version',
      );
    }

    const policyDiff = diffTopicVersionPolicies(fromPolicy, toPolicy);
    const tw = opts.timeWindow ?? 'WEEK';

    let rankPreview: Record<string, unknown> | null = null;
    if (opts.includeRankPreview !== false) {
      rankPreview = await this.buildVersionRankPreview(fromId, toId, tw);
    }

    return toPlainJson({
      topic: {
        id: fromVer.topic.id.toString(),
        slug: fromVer.topic.slug,
        title: fromVer.topic.title,
        kind: fromVer.topic.kind,
      },
      from: this.serializeVersionBrief(fromVer),
      to: this.serializeVersionBrief(toVer),
      policyDiff,
      rankPreview,
      generatedAt: new Date().toISOString(),
    });
  }

  private serializeVersionBrief(v: {
    id: bigint;
    version: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    frozen: boolean;
  }) {
    return {
      id: v.id.toString(),
      version: v.version,
      effectiveFrom: v.effectiveFrom.toISOString(),
      effectiveTo: v.effectiveTo?.toISOString() ?? null,
      frozen: v.frozen,
    };
  }

  private async buildVersionRankPreview(
    fromVersionId: bigint,
    toVersionId: bigint,
    timeWindow: TimeWindow,
  ) {
    const [fromSnap, toSnap] = await Promise.all([
      this.latestSnapshotForVersion(fromVersionId, timeWindow),
      this.latestSnapshotForVersion(toVersionId, timeWindow),
    ]);

    if (!fromSnap || !toSnap) {
      return {
        timeWindow,
        available: false,
        reason: 'missing snapshot on one or both versions',
        fromSnapshotId: fromSnap?.id.toString() ?? null,
        toSnapshotId: toSnap?.id.toString() ?? null,
      };
    }

    const [fromItems, toItems] = await Promise.all([
      this.prisma.rankingItem.findMany({
        where: { snapshotId: fromSnap.id },
        include: { entity: { select: { id: true, canonicalName: true } } },
      }),
      this.prisma.rankingItem.findMany({
        where: { snapshotId: toSnap.id },
        include: { entity: { select: { id: true, canonicalName: true } } },
      }),
    ]);

    const fromRank = new Map(fromItems.map((i) => [i.entityId.toString(), i]));
    const toRank = new Map(toItems.map((i) => [i.entityId.toString(), i]));

    type Mover = {
      entityId: string;
      canonicalName: string;
      fromRank: number | null;
      toRank: number | null;
      rankDelta: number | null;
    };

    const movers: Mover[] = [];
    const allIds = new Set([...fromRank.keys(), ...toRank.keys()]);
    for (const eid of allIds) {
      const a = fromRank.get(eid);
      const b = toRank.get(eid);
      const fromR = a?.rank ?? null;
      const toR = b?.rank ?? null;
      let rankDelta: number | null = null;
      if (fromR != null && toR != null) rankDelta = fromR - toR;
      movers.push({
        entityId: eid,
        canonicalName:
          b?.entity?.canonicalName ?? a?.entity?.canonicalName ?? eid,
        fromRank: fromR,
        toRank: toR,
        rankDelta,
      });
    }

    movers.sort((x, y) => {
      const ax = Math.abs(x.rankDelta ?? 99999);
      const ay = Math.abs(y.rankDelta ?? 99999);
      return ay - ax;
    });

    return {
      timeWindow,
      available: true,
      fromSnapshot: {
        id: fromSnap.id.toString(),
        snapshotTime: fromSnap.snapshotTime.toISOString(),
        itemCount: fromItems.length,
      },
      toSnapshot: {
        id: toSnap.id.toString(),
        snapshotTime: toSnap.snapshotTime.toISOString(),
        itemCount: toItems.length,
      },
      movers: movers.slice(0, 50),
      entered: movers.filter((m) => m.fromRank == null && m.toRank != null).length,
      dropped: movers.filter((m) => m.fromRank != null && m.toRank == null).length,
    };
  }

  private async latestSnapshotForVersion(topicVersionId: bigint, timeWindow: TimeWindow) {
    const ranking = await this.prisma.topicRanking.findFirst({
      where: { topicVersionId, timeWindow, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    });
    if (!ranking) return null;
    return this.prisma.topicRankSnapshot.findFirst({
      where: { topicRankingId: ranking.id },
      orderBy: { snapshotTime: 'desc' },
    });
  }
}
