/** 与 Nest `OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT` / OutboxEvent.type 一致 */
export const OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT =
  "clickhouse.ranking.snapshot.ingest" as const;

export type ClickhouseRankingSnapshotOutboxPreview = {
  snapshotId: string;
};

/** 自 Outbox 列表 API 单行 `payload` 解析（与后端 `ClickhouseRankingSnapshotOutboxPayload` 一致） */
export function parseClickhouseRankingSnapshotOutboxPreview(
  type: string,
  payload: unknown,
): ClickhouseRankingSnapshotOutboxPreview | undefined {
  if (type !== OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT) return undefined;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const p = payload as Record<string, unknown>;
  if (p.snapshotId == null) return undefined;
  return { snapshotId: String(p.snapshotId) };
}
