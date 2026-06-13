/** 与 API `includeAiStats` / 话题 snapshots 列表一致的 AiAnalysis 简报标记 */
export type SnapshotAiBriefStats = {
  aiAnalysisCount?: number;
  hasFollowupBrief?: boolean;
  hasTrendBrief?: boolean;
  hasCredibilityBrief?: boolean;
  hasFactCheckBrief?: boolean;
  hasTrendAnalysisBrief?: boolean;
  hasTimeSeriesBrief?: boolean;
  hasRankingBrief?: boolean;
};

export function briefCell(value: boolean | undefined): string {
  return value === true ? "是" : "—";
}

/** 紧凑展示已存在的 agent 简报（用于快照详情一行摘要） */
export function formatSnapshotBriefSummary(
  stats: SnapshotAiBriefStats,
): string {
  const parts: string[] = [];
  if (stats.hasFollowupBrief) parts.push("跟进");
  if (stats.hasTrendBrief) parts.push("趋势");
  if (stats.hasCredibilityBrief) parts.push("可信");
  if (stats.hasFactCheckBrief) parts.push("核查");
  if (stats.hasTrendAnalysisBrief) parts.push("涨榜");
  if (stats.hasTimeSeriesBrief) parts.push("时序");
  if (stats.hasRankingBrief) parts.push("排行");
  return parts.length > 0 ? parts.join(" · ") : "无";
}

export function compareSnapshotBriefKinds(
  s: SnapshotAiBriefStats,
): string[] {
  const kinds: string[] = [];
  if (s.hasFollowupBrief) kinds.push("跟进");
  if (s.hasTrendBrief) kinds.push("趋势");
  if (s.hasCredibilityBrief) kinds.push("可信度");
  if (s.hasFactCheckBrief) kinds.push("核查");
  if (s.hasTrendAnalysisBrief) kinds.push("涨榜");
  if (s.hasTimeSeriesBrief) kinds.push("时序");
  if (s.hasRankingBrief) kinds.push("排行");
  return kinds;
}
