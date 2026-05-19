import type { Prisma, TimeWindow } from '@prisma/client';

export type RankPoint = { rank: number };

/** 单次快照名次写入后的 streak 与极值 */
export function nextEntityTopicStats(args: {
  prev: {
    bestRank: number;
    worstRank: number;
    currentStreakUp: number;
    currentStreakDown: number;
    lastRank: number | null;
  } | null;
  newRank: number;
  asOf: Date;
}): {
  bestRank: number;
  worstRank: number;
  currentStreakUp: number;
  currentStreakDown: number;
  lastRank: number;
  lastAsOf: Date;
} {
  if (!args.prev) {
    return {
      bestRank: args.newRank,
      worstRank: args.newRank,
      currentStreakUp: 0,
      currentStreakDown: 0,
      lastRank: args.newRank,
      lastAsOf: args.asOf,
    };
  }

  let currentStreakUp = 0;
  let currentStreakDown = 0;
  if (args.prev.lastRank != null) {
    if (args.newRank < args.prev.lastRank) {
      currentStreakUp = args.prev.currentStreakUp + 1;
    } else if (args.newRank > args.prev.lastRank) {
      currentStreakDown = args.prev.currentStreakDown + 1;
    }
  }

  return {
    bestRank: Math.min(args.prev.bestRank, args.newRank),
    worstRank: Math.max(args.prev.worstRank, args.newRank),
    currentStreakUp,
    currentStreakDown,
    lastRank: args.newRank,
    lastAsOf: args.asOf,
  };
}

export async function upsertEntityTopicStatsBatch(
  tx: Prisma.TransactionClient,
  topicId: bigint,
  timeWindow: TimeWindow,
  asOf: Date,
  items: Array<{ entityId: bigint; rank: number }>,
): Promise<void> {
  for (const it of items) {
    const prev = await tx.entityTopicStats.findUnique({
      where: {
        entityId_topicId_timeWindow: {
          entityId: it.entityId,
          topicId,
          timeWindow,
        },
      },
    });
    const next = nextEntityTopicStats({
      prev: prev
        ? {
            bestRank: prev.bestRank,
            worstRank: prev.worstRank,
            currentStreakUp: prev.currentStreakUp,
            currentStreakDown: prev.currentStreakDown,
            lastRank: prev.lastRank,
          }
        : null,
      newRank: it.rank,
      asOf,
    });
    await tx.entityTopicStats.upsert({
      where: {
        entityId_topicId_timeWindow: {
          entityId: it.entityId,
          topicId,
          timeWindow,
        },
      },
      create: {
        entityId: it.entityId,
        topicId,
        timeWindow,
        ...next,
      },
      update: next,
    });
  }
}
