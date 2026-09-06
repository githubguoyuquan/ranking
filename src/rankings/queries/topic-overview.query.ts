import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestContext } from '../../compliance/compliance-auth.types';
import { querySection } from '../../lib/query/query-section';
import { toPlainJson } from '../../lib/json';
import { topicKindStrategyPublic } from '../../domain/topic-kind-policy';
import { RankingsService } from '../rankings.service';
import { TopicRankingQuery, type LeaderboardSelection, leaderboardResolved } from './topic-ranking.query';

@Injectable()
export class TopicOverviewQuery {
  constructor(private readonly prisma: PrismaService, private readonly selection: TopicRankingQuery, private readonly rankings: RankingsService) {}

  async get(slug: string, query: LeaderboardSelection & { recentLimit?: number }, auth?: AuthenticatedRequestContext) {
    const context = await this.selection.resolve(slug, query, auth);
    const { topic, version, ranking, snapshot } = context;
    const [leaderboard, recentSnapshots] = await Promise.all([
      querySection(async () => {
        if (!snapshot) return null;
        const payload = await this.rankings.getSnapshotForApiWithAuth(snapshot.id, { auth, includeAiStats: query.includeAiStats });
        return payload ? { resolved: leaderboardResolved(context), snapshot: payload } : null;
      }),
      querySection(async () => version ? this.prisma.topicRankSnapshot.findMany({
        where: { topicRanking: {
          topicVersionId: version.id,
          ...((ranking?.timeWindow ?? query.timeWindow) ? { timeWindow: ranking?.timeWindow ?? query.timeWindow } : {}),
          ...(query.windowStart ? { windowStart: new Date(query.windowStart) } : {}),
        } },
        orderBy: [{ snapshotTime: 'desc' }, { id: 'desc' }], take: Math.min(query.recentLimit ?? 5, 10),
        select: { id: true, snapshotTime: true, topicRanking: { select: { timeWindow: true } } },
      }) : [], (rows) => rows.length === 0),
    ]);
    return toPlainJson({
      topic: { id: topic.id, slug: topic.slug, title: topic.title, kind: topic.kind, kindStrategy: topicKindStrategyPublic(topic.kind) },
      selection: { requestedVersion: query.version ?? null, requestedWindow: query.timeWindow ?? null, resolvedVersionId: version?.id ?? null, rankingId: ranking?.id ?? null },
      leaderboard, recentSnapshots,
      meta: { schemaVersion: 1, requestId: randomUUID(), generatedAt: new Date().toISOString(), partial: [leaderboard, recentSnapshots].some(s => s.status === 'unavailable') },
    });
  }
}
