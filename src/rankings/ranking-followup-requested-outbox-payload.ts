import type { TimeWindow } from '@prisma/client';

/** `OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED` 行 `payload`（不经 Kafka publisher） */
export type RankingFollowupRequestedOutboxPayload = {
  schemaVersion: 1;
  snapshotId: string;
  topicRankingId: string;
  topicVersionId: string;
  topicId: string;
  timeWindow: TimeWindow;
  snapshotTime: string;
};

export function buildRankingFollowupRequestedOutboxPayload(args: {
  snapshotId: string;
  topicRankingId: string;
  topicVersionId: string;
  topicId: string;
  timeWindow: TimeWindow;
  snapshotTime: Date;
}): RankingFollowupRequestedOutboxPayload {
  return {
    schemaVersion: 1,
    snapshotId: args.snapshotId,
    topicRankingId: args.topicRankingId,
    topicVersionId: args.topicVersionId,
    topicId: args.topicId,
    timeWindow: args.timeWindow,
    snapshotTime: args.snapshotTime.toISOString(),
  };
}
