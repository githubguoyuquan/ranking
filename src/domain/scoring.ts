/**
 * Rank delta convention: positive rankChange means moved UP (better).
 * rankChange = previousRank - rank (lower rank number is better).
 */

export type DecayKind = 'exponential' | 'piecewise';

export interface DecayParams {
  halfLifeDays?: number;
  breakpoints?: Array<{ maxAgeDays: number; weight: number }>;
}

export function timeWeight(ts: Date, now: Date, kind: DecayKind, p: DecayParams): number {
  const ageDays = Math.max(0, (now.getTime() - ts.getTime()) / 86_400_000);

  if (kind === 'exponential') {
    const hl = p.halfLifeDays ?? 7;
    return 0.5 ** (ageDays / hl);
  }

  const bps = p.breakpoints?.slice().sort((a, c) => a.maxAgeDays - c.maxAgeDays) ?? [
    { maxAgeDays: 7, weight: 1 },
    { maxAgeDays: 30, weight: 0.6 },
    { maxAgeDays: 365, weight: 0.25 },
  ];
  for (const b of bps) {
    if (ageDays <= b.maxAgeDays) return b.weight;
  }
  return 0.05;
}

export function trustFromSourceTier(tier: number): number {
  return 1 / (1 + Math.exp(tier - 2));
}

export interface SignalObservation {
  key: string;
  raw: number;
  observedAt: Date;
  tier: number;
}

export function blendedObservation(
  value: number,
  observedAt: Date,
  now: Date,
  tier: number,
  decay: DecayParams,
): number {
  return (
    value * timeWeight(observedAt, now, 'exponential', decay) * trustFromSourceTier(tier)
  );
}

export function robustMinMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const q05 = sorted[Math.floor(0.05 * (sorted.length - 1))] ?? sorted[0];
  const q95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? sorted[sorted.length - 1];
  const span = Math.max(1e-9, q95 - q05);
  return values.map((v) => Math.min(1, Math.max(0, (v - q05) / span)));
}

export function scoreEntity(
  signals: SignalObservation[],
  weights: Record<string, number>,
  now: Date,
  decayParams?: DecayParams,
): { total: number; breakdown: Record<string, number> } {
  const decay: DecayParams = decayParams ?? { halfLifeDays: 10 };
  const breakdown: Record<string, number> = {};

  for (const s of signals) {
    const w = weights[s.key] ?? 0;
    const v = blendedObservation(s.raw, s.observedAt, now, s.tier, decay);
    breakdown[s.key] = v * w;
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}

export function ewma(series: number[], alpha = 0.2): number[] {
  const out: number[] = [];
  let prev = series[0] ?? 0;
  for (const x of series) {
    prev = alpha * x + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

export function leastSquaresSlope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (y[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function standardDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v =
    values.reduce((acc, x) => acc + (x - m) ** 2, 0) / Math.max(1, values.length - 1);
  return Math.sqrt(v);
}

export function classifyTrend(slope: number, volatility: number): string {
  if (slope > 0.15) return 'SURGE';
  if (slope > 0.05 && volatility < 0.2) return 'STEADY_UP';
  if (slope < -0.15) return 'DECLINE';
  if (slope < -0.05 && volatility < 0.2) return 'STEADY_DOWN';
  if (volatility > 0.35) return 'VOLATILE';
  return 'FLAT';
}

export function aiConfidence(coverage: number, variance: number, avgTier: number): number {
  const trust = trustFromSourceTier(avgTier);
  return Math.max(0, Math.min(1, 0.5 * coverage + 0.3 * (1 - variance) + 0.2 * trust));
}

/** 从时间序列末端向前数：连续「名次数字变小（排名上升）」的步数 */
export function endStreakRankImproving(historyAsc: Array<{ rank: number }>): number {
  if (historyAsc.length < 2) return 0;
  let s = 0;
  for (let i = historyAsc.length - 1; i > 0; i--) {
    if (historyAsc[i]!.rank < historyAsc[i - 1]!.rank) s++;
    else break;
  }
  return s;
}

/** 从时间序列末端向前数：连续「名次数字变大（排名下降）」的步数 */
export function endStreakRankDeclining(historyAsc: Array<{ rank: number }>): number {
  if (historyAsc.length < 2) return 0;
  let s = 0;
  for (let i = historyAsc.length - 1; i > 0; i--) {
    if (historyAsc[i]!.rank > historyAsc[i - 1]!.rank) s++;
    else break;
  }
  return s;
}
