import type { TopicRankSnapshot } from '@prisma/client';

/**
 * 排行快照 → API / BullMQ `returnvalue` 用纯 JSON（BigInt→string，并附 **`hasScoreModel`**）。
 */
export function toRankingSnapshotPlainJson(
  snapshot: TopicRankSnapshot & { items: unknown },
): Record<string, unknown> {
  const base = JSON.parse(
    JSON.stringify(snapshot, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  ) as Record<string, unknown>;
  base.hasScoreModel = snapshot.scoreModelId != null;
  return base;
}
