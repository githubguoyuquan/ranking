import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CollaborativeEntityHit = {
  entityId: string;
  canonicalName: string;
  coRankCount: number;
  score: number;
};

/**
 * 基于同榜共现的轻量协同过滤（Item-based CF）。
 * 从话题最新快照 TOP N 内统计与锚点实体同榜次数。
 */
@Injectable()
export class CollaborativeFilteringService {
  constructor(private readonly prisma: PrismaService) {}

  async recommendEntities(params: {
    entityId: bigint;
    topicSlug?: string;
    topN?: number;
    limit?: number;
  }): Promise<{
    anchorEntityId: string;
    hits: CollaborativeEntityHit[];
    reason?: string;
    snapshotId?: string;
    topN?: number;
  }> {
    const entity = await this.prisma.entity.findUnique({
      where: { id: params.entityId },
      select: { id: true, canonicalName: true },
    });
    if (!entity) throw new NotFoundException('entity not found');

    const topN = Math.min(Math.max(params.topN ?? 30, 5), 100);
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 30);

    let topicId: bigint | undefined;
    if (params.topicSlug?.trim()) {
      const topic = await this.prisma.topic.findFirst({
        where: { slug: params.topicSlug.trim() },
        select: { id: true },
      });
      if (!topic) throw new NotFoundException('topic not found');
      topicId = topic.id;
    }

    const snapshot = await this.findLatestSnapshot(topicId);
    if (!snapshot) {
      return {
        anchorEntityId: entity.id.toString(),
        hits: [],
        reason: 'no snapshot',
      };
    }

    const items = await this.prisma.rankingItem.findMany({
      where: { snapshotId: snapshot.id, rank: { lte: topN } },
      select: {
        entityId: true,
        rank: true,
        entity: { select: { canonicalName: true } },
      },
    });

    const anchorItem = items.find((i) => i.entityId === entity.id);
    if (!anchorItem) {
      return {
        anchorEntityId: entity.id.toString(),
        hits: [],
        reason: 'anchor not in snapshot topN',
      };
    }

    const counts = new Map<
      string,
      { entityId: bigint; canonicalName: string; coRankCount: number; rankSum: number }
    >();

    for (const item of items) {
      if (item.entityId === entity.id) continue;
      const key = item.entityId.toString();
      const cur = counts.get(key) ?? {
        entityId: item.entityId,
        canonicalName: item.entity.canonicalName,
        coRankCount: 0,
        rankSum: 0,
      };
      cur.coRankCount += 1;
      cur.rankSum += Math.abs(item.rank - anchorItem.rank);
      counts.set(key, cur);
    }

    const hits: CollaborativeEntityHit[] = [...counts.values()]
      .map((c) => ({
        entityId: c.entityId.toString(),
        canonicalName: c.canonicalName,
        coRankCount: c.coRankCount,
        score: c.coRankCount / (1 + c.rankSum / c.coRankCount),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      anchorEntityId: entity.id.toString(),
      snapshotId: snapshot.id.toString(),
      topN,
      hits,
    };
  }

  private async findLatestSnapshot(topicId?: bigint) {
    if (topicId) {
      return this.prisma.topicRankSnapshot.findFirst({
        where: {
          topicRanking: { topicVersion: { topicId } },
        },
        orderBy: { snapshotTime: 'desc' },
        select: { id: true },
      });
    }
    return this.prisma.topicRankSnapshot.findFirst({
      orderBy: { snapshotTime: 'desc' },
      select: { id: true },
    });
  }
}
