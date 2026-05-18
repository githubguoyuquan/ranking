import type { TimeWindow } from '@prisma/client';

/** `OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED` → Kafka `ranking.snapshot.completed` 的 JSON 形状（契约层）。 */
export type RankingSnapshotCompletedOutboxPayload = {
  schemaVersion: 1;
  snapshotId: string;
  topicRankingId: string;
  topicVersionId: string;
  topicId: string;
  topicVersionLabel: string;
  timeWindow: TimeWindow;
  snapshotTime: string;
  snapshotVersion: string;
  itemCount: number;
  confidenceScore: number;
  hasScoreModel: boolean;
  scoreModelId: string | null;
};

export function buildRankingSnapshotCompletedOutboxPayload(args: {
  snapshotId: bigint;
  topicRankingId: bigint;
  topicVersionId: bigint;
  topicId: bigint;
  topicVersionLabel: string;
  timeWindow: TimeWindow;
  snapshotTime: Date;
  snapshotVersion: string;
  itemCount: number;
  confidenceScore: number;
  scoreModelId: bigint | null;
}): RankingSnapshotCompletedOutboxPayload {
  return {
    schemaVersion: 1,
    snapshotId: args.snapshotId.toString(),
    topicRankingId: args.topicRankingId.toString(),
    topicVersionId: args.topicVersionId.toString(),
    topicId: args.topicId.toString(),
    topicVersionLabel: args.topicVersionLabel,
    timeWindow: args.timeWindow,
    snapshotTime: args.snapshotTime.toISOString(),
    snapshotVersion: args.snapshotVersion,
    itemCount: args.itemCount,
    confidenceScore: args.confidenceScore,
    hasScoreModel: args.scoreModelId != null,
    scoreModelId: args.scoreModelId != null ? args.scoreModelId.toString() : null,
  };
}
