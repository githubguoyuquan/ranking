/** 同事务插入的 `OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT` 行 `payload` 形状 */
export type ClickhouseRankingSnapshotOutboxPayload = {
  schemaVersion: 1;
  snapshotId: string;
};

export function buildClickhouseRankingSnapshotOutboxPayload(args: {
  snapshotId: bigint;
}): ClickhouseRankingSnapshotOutboxPayload {
  return {
    schemaVersion: 1,
    snapshotId: args.snapshotId.toString(),
  };
}
