/** 异步跑榜轮询时压缩展示 `GET /v1/rankings/:id/status` JSON（含 `hasScoreModel`）。 */
export function formatTopicRankingStatusSummary(text: string): string {
  try {
    const o = JSON.parse(text) as {
      status?: string;
      lastError?: string | null;
      snapshots?: Array<{
        id?: string | number | bigint;
        hasScoreModel?: boolean;
      }>;
    };
    const lines = [`DB status=${o.status ?? "?"}`];
    if (o.lastError) lines.push(`lastError: ${o.lastError}`);
    const latest = o.snapshots?.[0];
    if (latest?.id != null && latest.id !== "") {
      lines.push(`latestSnapshotId: ${String(latest.id)}`);
      if (typeof latest.hasScoreModel === "boolean") {
        lines.push(
          `latestHasScoreModel: ${latest.hasScoreModel ? "yes" : "no"}`,
        );
      }
    }
    return lines.join("\n");
  } catch {
    return text;
  }
}
