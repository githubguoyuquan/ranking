import { endStreakRankImproving, endStreakRankDeclining } from './scoring';

export function rankingHistorySummary(points: Array<{ rank: number }>, stats?: {
  bestRank: number; worstRank: number; currentStreakUp: number; currentStreakDown: number;
} | null) {
  if (stats) return {
    bestRank: stats.bestRank, worstRank: stats.worstRank,
    endStreakRankImproving: stats.currentStreakUp, endStreakRankDeclining: stats.currentStreakDown,
    pointCount: points.length, materialized: true, summaryScope: 'materialized_history' as const,
  };
  if (!points.length) return null;
  return { bestRank: Math.min(...points.map(p => p.rank)), worstRank: Math.max(...points.map(p => p.rank)),
    endStreakRankImproving: endStreakRankImproving(points), endStreakRankDeclining: endStreakRankDeclining(points),
    pointCount: points.length, materialized: false, summaryScope: 'returned_points' as const };
}
