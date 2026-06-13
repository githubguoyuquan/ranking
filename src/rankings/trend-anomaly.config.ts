import type { TrendAnomalyThresholds } from '../domain/trend-anomaly';

/** 趋势异常 / 告警阈值（环境变量可覆盖） */
export function trendAnomalyThresholds(): TrendAnomalyThresholds {
  return {
    minRankChangeWarn: numEnv('TREND_ANOMALY_RANK_CHANGE_WARN', 3),
    minRankChangeCritical: numEnv('TREND_ANOMALY_RANK_CHANGE_CRITICAL', 8),
    surgeCountWarn: numEnv('TREND_ANOMALY_SURGE_COUNT_WARN', 2),
    volatileShareWarn: floatEnv('TREND_ANOMALY_VOLATILE_SHARE_WARN', 0.35),
    momentumImbalanceRatio: floatEnv('TREND_ANOMALY_MOMENTUM_RATIO_WARN', 3),
    streakStepsWarn: numEnv('TREND_ANOMALY_STREAK_STEPS_WARN', 4),
  };
}

function numEnv(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function floatEnv(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
