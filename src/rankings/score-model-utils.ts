import { createHash } from 'crypto';

/** 对权重做稳定指纹，便于同一 TopicVersion+权重方案复用一条 `ScoreModel`。 */
export function stableWeightsFingerprint(weights: Record<string, number>): string {
  const keys = Object.keys(weights).sort();
  const payload = keys.map((k) => `${k}=${weights[k]}`).join('&');
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}

/** 将 `RankingItem.scoreBreakdown` JSON 解析为 API/导出用记录（仅保留有限数字）。 */
export function parseScoreBreakdownJson(raw: unknown): Record<string, number> | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(raw)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
