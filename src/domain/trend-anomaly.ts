import {
  endStreakRankDeclining,
  endStreakRankImproving,
} from './scoring';

export type TrendAnomalySeverity = 'warn' | 'critical';

export type TrendAnomalyThresholds = {
  minRankChangeWarn: number;
  minRankChangeCritical: number;
  surgeCountWarn: number;
  volatileShareWarn: number;
  momentumImbalanceRatio: number;
  streakStepsWarn: number;
};

export type TrendAnomalyItem = {
  code: string;
  severity: TrendAnomalySeverity;
  topicId: string;
  topicSlug?: string;
  snapshotId?: string;
  entityId?: string;
  entityName?: string;
  message: string;
  value?: number;
  threshold?: number;
  detectedAt: string;
};

export type SnapshotTrendPayload = {
  kind?: string;
  snapshotId?: string;
  snapshotTime?: string;
  itemCount?: number;
  trendTypeCounts?: Record<string, number>;
  topRankGainers?: Array<{
    entityId?: string;
    canonicalName?: string;
    rankChange?: number;
  }>;
  topRankLosers?: Array<{
    entityId?: string;
    canonicalName?: string;
    rankChange?: number;
  }>;
};

export function detectAnomaliesFromSnapshotSummary(
  payload: SnapshotTrendPayload,
  thresholds: TrendAnomalyThresholds,
  ctx: { topicId: string; topicSlug?: string; analysisCreatedAt: Date },
): TrendAnomalyItem[] {
  if (payload.kind && payload.kind !== 'snapshot_summary') return [];

  const detectedAt = ctx.analysisCreatedAt.toISOString();
  const out: TrendAnomalyItem[] = [];
  const base = { topicId: ctx.topicId, topicSlug: ctx.topicSlug, snapshotId: payload.snapshotId, detectedAt };

  for (const g of payload.topRankGainers ?? []) {
    const rc = typeof g.rankChange === 'number' ? g.rankChange : Number(g.rankChange);
    if (!g.entityId || !Number.isFinite(rc) || rc <= 0) continue;
    if (rc >= thresholds.minRankChangeCritical) {
      out.push({
        ...base,
        code: 'entity_rank_surge',
        severity: 'critical',
        entityId: String(g.entityId),
        entityName: g.canonicalName,
        value: rc,
        threshold: thresholds.minRankChangeCritical,
        message: `${g.canonicalName ?? g.entityId} 单次名次上升 ${rc}（≥${thresholds.minRankChangeCritical}）`,
      });
    } else if (rc >= thresholds.minRankChangeWarn) {
      out.push({
        ...base,
        code: 'entity_rank_surge',
        severity: 'warn',
        entityId: String(g.entityId),
        entityName: g.canonicalName,
        value: rc,
        threshold: thresholds.minRankChangeWarn,
        message: `${g.canonicalName ?? g.entityId} 名次上升 ${rc}`,
      });
    }
  }

  for (const l of payload.topRankLosers ?? []) {
    const rc = typeof l.rankChange === 'number' ? l.rankChange : Number(l.rankChange);
    if (!l.entityId || !Number.isFinite(rc) || rc >= 0) continue;
    const drop = Math.abs(rc);
    if (drop >= thresholds.minRankChangeCritical) {
      out.push({
        ...base,
        code: 'entity_rank_plunge',
        severity: 'critical',
        entityId: String(l.entityId),
        entityName: l.canonicalName,
        value: drop,
        threshold: thresholds.minRankChangeCritical,
        message: `${l.canonicalName ?? l.entityId} 单次名次下跌 ${drop}（≥${thresholds.minRankChangeCritical}）`,
      });
    } else if (drop >= thresholds.minRankChangeWarn) {
      out.push({
        ...base,
        code: 'entity_rank_plunge',
        severity: 'warn',
        entityId: String(l.entityId),
        entityName: l.canonicalName,
        value: drop,
        threshold: thresholds.minRankChangeWarn,
        message: `${l.canonicalName ?? l.entityId} 名次下跌 ${drop}`,
      });
    }
  }

  const counts = payload.trendTypeCounts ?? {};
  const itemCount = Math.max(1, payload.itemCount ?? 0);
  const surgeCount = counts.SURGE ?? 0;
  if (surgeCount >= thresholds.surgeCountWarn) {
    out.push({
      ...base,
      code: 'snapshot_surge_cluster',
      severity: surgeCount >= thresholds.surgeCountWarn * 2 ? 'critical' : 'warn',
      value: surgeCount,
      threshold: thresholds.surgeCountWarn,
      message: `快照内 SURGE 实体 ${surgeCount} 个（阈值 ${thresholds.surgeCountWarn}）`,
    });
  }

  const volatileCount = counts.VOLATILE ?? 0;
  const volatileShare = volatileCount / itemCount;
  if (volatileShare >= thresholds.volatileShareWarn) {
    out.push({
      ...base,
      code: 'snapshot_volatile_cluster',
      severity: volatileShare >= Math.min(1, thresholds.volatileShareWarn * 1.5) ? 'critical' : 'warn',
      value: volatileShare,
      threshold: thresholds.volatileShareWarn,
      message: `VOLATILE 占比 ${(volatileShare * 100).toFixed(0)}%（阈值 ${(thresholds.volatileShareWarn * 100).toFixed(0)}%）`,
    });
  }

  const gainerCount = (payload.topRankGainers ?? []).filter((g) => (g.rankChange ?? 0) > 0).length;
  const loserCount = (payload.topRankLosers ?? []).filter((l) => (l.rankChange ?? 0) < 0).length;
  if (gainerCount > 0 && loserCount > 0) {
    const ratio = Math.max(gainerCount, loserCount) / Math.min(gainerCount, loserCount);
    if (ratio >= thresholds.momentumImbalanceRatio) {
      const dominant = gainerCount > loserCount ? '涨榜' : '跌榜';
      out.push({
        ...base,
        code: 'snapshot_momentum_imbalance',
        severity: ratio >= thresholds.momentumImbalanceRatio * 1.5 ? 'critical' : 'warn',
        value: ratio,
        threshold: thresholds.momentumImbalanceRatio,
        message: `${dominant}主导：涨 ${gainerCount} / 跌 ${loserCount}（比值 ${ratio.toFixed(1)}）`,
      });
    }
  }

  return out;
}

export function detectStreakAnomalies(
  points: Array<{ rank: number }>,
  thresholds: TrendAnomalyThresholds,
  ctx: {
    topicId: string;
    topicSlug?: string;
    entityId: string;
    entityName?: string;
    detectedAt: Date;
  },
): TrendAnomalyItem[] {
  const up = endStreakRankImproving(points);
  const down = endStreakRankDeclining(points);
  const detectedAt = ctx.detectedAt.toISOString();
  const out: TrendAnomalyItem[] = [];

  if (up >= thresholds.streakStepsWarn) {
    out.push({
      code: 'entity_streak_improving',
      severity: up >= thresholds.streakStepsWarn * 2 ? 'critical' : 'warn',
      topicId: ctx.topicId,
      topicSlug: ctx.topicSlug,
      entityId: ctx.entityId,
      entityName: ctx.entityName,
      value: up,
      threshold: thresholds.streakStepsWarn,
      message: `${ctx.entityName ?? ctx.entityId} 连续 ${up} 步名次上升`,
      detectedAt,
    });
  }
  if (down >= thresholds.streakStepsWarn) {
    out.push({
      code: 'entity_streak_declining',
      severity: down >= thresholds.streakStepsWarn * 2 ? 'critical' : 'warn',
      topicId: ctx.topicId,
      topicSlug: ctx.topicSlug,
      entityId: ctx.entityId,
      entityName: ctx.entityName,
      value: down,
      threshold: thresholds.streakStepsWarn,
      message: `${ctx.entityName ?? ctx.entityId} 连续 ${down} 步名次下降`,
      detectedAt,
    });
  }
  return out;
}

/** 去重：同 code+entityId+snapshotId 保留最高严重度 */
export function dedupeTrendAnomalies(items: TrendAnomalyItem[]): TrendAnomalyItem[] {
  const rank = (s: TrendAnomalySeverity) => (s === 'critical' ? 2 : 1);
  const key = (a: TrendAnomalyItem) =>
    `${a.code}:${a.entityId ?? ''}:${a.snapshotId ?? ''}:${a.topicId}`;
  const best = new Map<string, TrendAnomalyItem>();
  for (const a of items) {
    const k = key(a);
    const prev = best.get(k);
    if (!prev || rank(a.severity) > rank(prev.severity)) best.set(k, a);
  }
  return [...best.values()].sort((a, b) => rank(b.severity) - rank(a.severity));
}

export function worstTrendAlertStatus(
  items: TrendAnomalyItem[],
): 'ok' | 'warn' | 'critical' {
  if (items.some((a) => a.severity === 'critical')) return 'critical';
  if (items.some((a) => a.severity === 'warn')) return 'warn';
  return 'ok';
}
