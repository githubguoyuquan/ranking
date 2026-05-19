export type TenantSettings = {
  aiAnalysisDailyCap?: number;
  aiEmbeddingDailyCap?: number;
};

export function parseTenantSettings(raw: unknown): TenantSettings {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: TenantSettings = {};
  if (o.aiAnalysisDailyCap !== undefined) {
    const n = Number(o.aiAnalysisDailyCap);
    if (Number.isFinite(n) && n >= 0) out.aiAnalysisDailyCap = n;
  }
  if (o.aiEmbeddingDailyCap !== undefined) {
    const n = Number(o.aiEmbeddingDailyCap);
    if (Number.isFinite(n) && n >= 0) out.aiEmbeddingDailyCap = n;
  }
  return out;
}
