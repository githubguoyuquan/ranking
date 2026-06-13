import { describe, expect, it } from 'vitest';
import {
  dedupeTrendAnomalies,
  detectAnomaliesFromSnapshotSummary,
  detectStreakAnomalies,
  worstTrendAlertStatus,
} from './trend-anomaly';

const thresholds = {
  minRankChangeWarn: 3,
  minRankChangeCritical: 8,
  surgeCountWarn: 2,
  volatileShareWarn: 0.35,
  momentumImbalanceRatio: 3,
  streakStepsWarn: 4,
};

describe('trend-anomaly', () => {
  it('detects large rank surge', () => {
    const items = detectAnomaliesFromSnapshotSummary(
      {
        kind: 'snapshot_summary',
        snapshotId: '1',
        itemCount: 10,
        topRankGainers: [{ entityId: '9', canonicalName: 'Alice', rankChange: 10 }],
      },
      thresholds,
      { topicId: '1', topicSlug: 'demo', analysisCreatedAt: new Date() },
    );
    expect(items.some((a) => a.code === 'entity_rank_surge' && a.severity === 'critical')).toBe(
      true,
    );
  });

  it('detects surge cluster and volatile share', () => {
    const items = detectAnomaliesFromSnapshotSummary(
      {
        kind: 'snapshot_summary',
        itemCount: 4,
        trendTypeCounts: { SURGE: 3, VOLATILE: 2 },
      },
      thresholds,
      { topicId: '2', analysisCreatedAt: new Date() },
    );
    expect(items.some((a) => a.code === 'snapshot_surge_cluster')).toBe(true);
    expect(items.some((a) => a.code === 'snapshot_volatile_cluster')).toBe(true);
  });

  it('detects streak anomalies', () => {
    const ranks = [10, 9, 8, 7, 6, 5].map((rank) => ({ rank }));
    const items = detectStreakAnomalies(ranks, thresholds, {
      topicId: '1',
      entityId: '5',
      entityName: 'Bob',
      detectedAt: new Date(),
    });
    expect(items.some((a) => a.code === 'entity_streak_improving')).toBe(true);
  });

  it('dedupes and worst status', () => {
    const merged = dedupeTrendAnomalies([
      {
        code: 'entity_rank_surge',
        severity: 'warn',
        topicId: '1',
        message: 'a',
        detectedAt: 't',
        entityId: '1',
      },
      {
        code: 'entity_rank_surge',
        severity: 'critical',
        topicId: '1',
        message: 'b',
        detectedAt: 't',
        entityId: '1',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.severity).toBe('critical');
    expect(worstTrendAlertStatus(merged)).toBe('critical');
  });
});
