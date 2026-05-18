/** 管理台 `/snapshots/[id]` query 与 Nest `GET /v1/snapshots/:id/analyses` 对齐 */

export const SNAPSHOT_DETAIL_QS = {
  analysisKind: "analysisKind",
  analysisPage: "analysisPage",
  analysisLimit: "analysisLimit",
} as const;

export function pickFirstSearchParam(
  sp: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | undefined {
  const v = sp?.[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

const MAX_PAGE = 10_000;
/** 与后端 `ListAnalysesQueryDto.offset` 上限协调 */
export const SNAPSHOT_ANALYSIS_OFFSET_MAX = 100_000;

export function parseSnapshotAnalysisPage(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

export function parseSnapshotAnalysisLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 50;
  return Math.min(200, n);
}

export function snapshotAnalysisListOffset(
  page: number,
  limit: number,
): number {
  const raw = (Math.max(1, page) - 1) * limit;
  return Math.min(raw, SNAPSHOT_ANALYSIS_OFFSET_MAX);
}

/**
 * 构建管理台快照详情 query（省略与默认相当的项：`analysisPage=1`、`analysisLimit=50`）。
 */
export function buildSnapshotDetailAdminQuery(input: {
  analysisKind: string;
  analysisPage: number;
  analysisLimit: number;
}): URLSearchParams {
  const qs = new URLSearchParams();
  if (input.analysisKind !== "") {
    qs.set(SNAPSHOT_DETAIL_QS.analysisKind, input.analysisKind);
  }
  if (input.analysisPage > 1) {
    qs.set(SNAPSHOT_DETAIL_QS.analysisPage, String(input.analysisPage));
  }
  if (input.analysisLimit !== 50) {
    qs.set(SNAPSHOT_DETAIL_QS.analysisLimit, String(input.analysisLimit));
  }
  return qs;
}
