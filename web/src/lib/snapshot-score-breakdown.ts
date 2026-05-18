/** `RankingItem.scoreBreakdown`（`scoreEntity` 各信号加权分量）解析为展示用条目 */
export function parseScoreBreakdownEntries(
  raw: unknown,
): Array<{ key: string; value: number }> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  const out: Array<{ key: string; value: number }> = [];
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push({ key: k, value: v });
    }
  }
  out.sort((a, b) => b.value - a.value);
  return out;
}
