import type { SnapshotAnalysisListItem } from "@/components/snapshot-analyses-section";

export type SnapshotAnalysesListFilter = {
  agentKind: string | null;
  agent: string | null;
  limit: number;
  offset: number;
};

/** `GET /v1/snapshots/:id/analyses` 分页响应（兼容历史纯数组） */
export function parseSnapshotAnalysesApiResponse(raw: unknown): {
  rows: SnapshotAnalysisListItem[];
  total: number;
  filter: SnapshotAnalysesListFilter | null;
} {
  if (Array.isArray(raw)) {
    const rows = raw as SnapshotAnalysisListItem[];
    return { rows, total: rows.length, filter: null };
  }
  if (raw && typeof raw === "object" && "analyses" in raw) {
    const o = raw as {
      analyses?: unknown;
      total?: unknown;
      filter?: unknown;
    };
    const rows = Array.isArray(o.analyses)
      ? (o.analyses as SnapshotAnalysisListItem[])
      : [];
    const total = typeof o.total === "number" ? o.total : rows.length;
    let filter: SnapshotAnalysesListFilter | null = null;
    if (o.filter && typeof o.filter === "object") {
      const f = o.filter as Record<string, unknown>;
      filter = {
        agentKind: typeof f.agentKind === "string" ? f.agentKind : null,
        agent: typeof f.agent === "string" ? f.agent : null,
        limit: typeof f.limit === "number" ? f.limit : 50,
        offset: typeof f.offset === "number" ? f.offset : 0,
      };
    }
    return { rows, total, filter };
  }
  return { rows: [], total: 0, filter: null };
}
