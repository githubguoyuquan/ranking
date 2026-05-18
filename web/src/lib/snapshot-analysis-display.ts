/** `detailJson.agentKind` from SnapshotAnalyzeService; legacy rows may omit. */
export function formatAgentKind(detailJson: unknown, agent: string): string {
  let kind: string | null = null;
  if (
    detailJson != null &&
    typeof detailJson === "object" &&
    "agentKind" in detailJson
  ) {
    const v = (detailJson as { agentKind?: unknown }).agentKind;
    kind = typeof v === "string" ? v : null;
  }
  if (kind === "followup") return "物化跟进";
  if (kind === "trend") return "趋势解读";
  if (kind === "credibility") return "可信度";
  if (kind === "default") return "默认";
  if (agent === "post-snapshot-summary-v1") return "物化跟进";
  if (agent === "trend-v1") return "趋势解读";
  if (agent === "credibility-v1") return "可信度";
  return "其他/历史";
}

/** `detailJson.usedChainContext` from `SnapshotAnalyzeService`（旧行无此字段则为 false） */
export function detailJsonUsedChainContext(detailJson: unknown): boolean {
  if (detailJson == null || typeof detailJson !== "object") return false;
  return (detailJson as { usedChainContext?: unknown }).usedChainContext === true;
}

export function truncateSummary(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}
