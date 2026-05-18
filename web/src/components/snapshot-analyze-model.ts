import {
  SNAPSHOT_ANALYZE_AGENT_MAX_LEN as AGENT_MAX,
  SNAPSHOT_ANALYZE_CHAIN_CONTEXT_MAX_LEN as CHAIN_CONTEXT_MAX,
  SNAPSHOT_ANALYZE_TOPN_INPUT_MAX_LEN as TOPN_INPUT_MAX_LEN,
  SNAPSHOT_ANALYZE_TOPN_MAX as TOPN_MAX,
  SNAPSHOT_ANALYZE_TOPN_MIN as TOPN_MIN,
} from "@/lib/admin-input-limits";

export { AGENT_MAX, CHAIN_CONTEXT_MAX, TOPN_INPUT_MAX_LEN, TOPN_MAX, TOPN_MIN };

export type TopNParseOk = { ok: true; value?: number };
export type TopNParseErr = { ok: false; message: string };
export type TopNParse = TopNParseOk | TopNParseErr;

export function parseOptionalTopN(raw: string): TopNParse {
  const t = raw.trim();
  if (t === "") return { ok: true, value: undefined };
  const n = Number(t);
  if (!Number.isInteger(n) || n < TOPN_MIN || n > TOPN_MAX) {
    return {
      ok: false,
      message: `topN 须为 ${TOPN_MIN}–${TOPN_MAX} 的整数，或留空`,
    };
  }
  return { ok: true, value: n };
}

export type SnapshotAnalyzeActionsProps = {
  snapshotId: string;
  /** 与当前页筛选一致；省略则用无 query 的默认 analyses URL */
  analysesGetUrl?: string;
};

export type AnalyzeRequestBody = {
  agent?: string;
  topN?: number;
  chainContext?: string;
};
