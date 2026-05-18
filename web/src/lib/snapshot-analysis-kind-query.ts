const ALLOWED = new Set(["followup", "trend", "credibility", "default"]);

/** 与 `GET /v1/snapshots/:id/analyses?agentKind=` 对应；管理台 query 用 `analysisKind` */
export type SnapshotPageAnalysisKind =
  | ""
  | "followup"
  | "trend"
  | "credibility"
  | "default";

export function parseSnapshotPageAnalysisKind(
  raw: string | undefined,
): SnapshotPageAnalysisKind {
  const t = raw?.trim() ?? "";
  if (t === "" || !ALLOWED.has(t)) return "";
  return t as SnapshotPageAnalysisKind;
}
