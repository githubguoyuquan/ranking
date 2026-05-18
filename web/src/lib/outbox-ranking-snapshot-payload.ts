/** 与 Nest `OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED` / Kafka topic 行 type 一致 */
export const OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED =
  "ranking.snapshot.completed" as const;

/** 管理台表格中便于扫一眼的字段（自 `OutboxEvent.payload` 解析） */
export type RankingSnapshotCompletedOutboxPreview = {
  snapshotId: string;
  hasScoreModel: boolean;
  scoreModelId: string | null;
};

/**
 * 从 outbox 列表 API 返回的单行 `payload` 解析 Kafka 排行完成事件摘要。
 * 旧行可能缺 `hasScoreModel` / `scoreModelId`，则按 `scoreModelId` 是否为空推断。
 */
export function parseRankingSnapshotCompletedOutboxPreview(
  type: string,
  payload: unknown,
): RankingSnapshotCompletedOutboxPreview | undefined {
  if (type !== OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED) return undefined;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const p = payload as Record<string, unknown>;
  if (p.snapshotId == null) return undefined;
  const snapshotId = String(p.snapshotId);

  let hasScoreModel: boolean;
  if (typeof p.hasScoreModel === "boolean") {
    hasScoreModel = p.hasScoreModel;
  } else {
    const sid = p.scoreModelId;
    hasScoreModel =
      sid != null && String(sid) !== "" && String(sid) !== "null";
  }

  let scoreModelId: string | null;
  if (p.scoreModelId == null || String(p.scoreModelId) === "null") {
    scoreModelId = null;
  } else {
    scoreModelId = String(p.scoreModelId);
  }

  return { snapshotId, hasScoreModel, scoreModelId };
}
