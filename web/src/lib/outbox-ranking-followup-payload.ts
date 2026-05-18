/** 与 Nest `OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED` 一致 */
export const OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED =
  "ranking.followup.requested" as const;

export type RankingFollowupRequestedOutboxPreview = {
  snapshotId: string;
  topicRankingId: string;
  topicVersionId: string;
  topicId: string;
  timeWindow: string;
  snapshotTime: string;
};

export function parseRankingFollowupRequestedOutboxPreview(
  type: string,
  payload: unknown,
): RankingFollowupRequestedOutboxPreview | undefined {
  if (type !== OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED) return undefined;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const p = payload as Record<string, unknown>;
  if (
    p.snapshotId == null ||
    p.topicRankingId == null ||
    p.topicVersionId == null ||
    p.topicId == null ||
    p.timeWindow == null ||
    p.snapshotTime == null
  ) {
    return undefined;
  }
  return {
    snapshotId: String(p.snapshotId),
    topicRankingId: String(p.topicRankingId),
    topicVersionId: String(p.topicVersionId),
    topicId: String(p.topicId),
    timeWindow: String(p.timeWindow),
    snapshotTime: String(p.snapshotTime),
  };
}
