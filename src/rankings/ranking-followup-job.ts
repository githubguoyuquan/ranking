import type { TimeWindow } from '@prisma/client';

/** 与主排行队列分离：物化成功后「下游编排」占位（摘要 / Agent DAG 等） */
export const RANKING_FOLLOWUP_QUEUE = 'ranking-followup';
export const RANKING_FOLLOWUP_JOB_NAME = 'post-snapshot';

export type RankingFollowupPayload = {
  schemaVersion: 1;
  snapshotId: string;
  topicRankingId: string;
  topicVersionId: string;
  topicId: string;
  timeWindow: TimeWindow;
};

/** BullMQ `jobId` 不得含 `:`；与主排行队列的 hash id 规则一致用连字符 */
export function buildRankingFollowupJobId(snapshotId: string): string {
  return `ranking-followup-${snapshotId}`;
}
