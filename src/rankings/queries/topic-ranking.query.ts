import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TimeWindow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestContext } from '../../compliance/compliance-auth.types';
import { topicWhereForAuth } from '../../compliance/tenant-scope';
import { resolveRealtimeRankingWindow } from '../../domain/realtime-ranking-window';

export type LeaderboardSelection = { version?: string; timeWindow?: TimeWindow; windowStart?: string; includeAiStats?: boolean };

@Injectable()
export class TopicRankingQuery {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(slug: string, query: LeaderboardSelection, auth?: AuthenticatedRequestContext | null) {
    if (query.windowStart !== undefined && query.timeWindow === undefined) {
      throw new BadRequestException('timeWindow is required when windowStart is set');
    }
    const topic = await this.prisma.topic.findFirst({ where: { slug: slug.trim(), ...topicWhereForAuth(auth) } });
    if (!topic) throw new NotFoundException('topic not found');
    const version = await this.prisma.topicVersion.findFirst({
      where: { topicId: topic.id, ...(query.version ? { version: query.version } : {}) },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
    });
    const ranking = version ? await this.prisma.topicRanking.findFirst({
      where: {
        topicVersionId: version.id,
        ...(query.timeWindow ? { timeWindow: query.timeWindow } : {}),
        ...(query.windowStart ? { windowStart: new Date(query.windowStart) } : { status: 'completed' }),
        snapshots: { some: {} },
      },
      orderBy: [{ windowStart: 'desc' }, { id: 'desc' }],
      include: { snapshots: { orderBy: [{ snapshotTime: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, snapshotTime: true, scoreModelId: true } } },
    }) : null;
    return { topic, version, ranking, snapshot: ranking?.snapshots[0] ?? null };
  }
}

export type ResolvedTopicRanking = Awaited<ReturnType<TopicRankingQuery['resolve']>>;

export function leaderboardResolved(context: ResolvedTopicRanking) {
  const { topic, version, ranking, snapshot } = context;
  if (!version || !ranking || !snapshot) return null;
  return {
    topicSlug: topic.slug, topicTitle: topic.title, topicVersionId: version.id.toString(),
    version: version.version, timeWindow: ranking.timeWindow,
    windowStart: ranking.windowStart.toISOString(), windowEnd: ranking.windowEnd.toISOString(),
    topicRankingId: ranking.id.toString(), snapshotId: snapshot.id.toString(),
    snapshotTime: snapshot.snapshotTime.toISOString(), hasScoreModel: snapshot.scoreModelId != null,
    ...(ranking.timeWindow === 'REALTIME' ? { realtimeSemantics: resolveRealtimeRankingWindow(ranking.windowEnd).semantics } : {}),
  };
}
