import { describe, expect, it } from 'vitest';
import {
  endStreakRankDeclining,
  endStreakRankImproving,
  robustMinMaxNormalize,
  timeWeight,
} from './scoring';

describe('scoring', () => {
  it('timeWeight exponential decays', () => {
    const now = new Date('2026-05-17T00:00:00Z');
    const recent = new Date('2026-05-16T00:00:00Z');
    const old = new Date('2026-04-17T00:00:00Z');
    expect(timeWeight(recent, now, 'exponential', { halfLifeDays: 7 })).toBeGreaterThan(
      timeWeight(old, now, 'exponential', { halfLifeDays: 7 }),
    );
  });

  it('robustMinMaxNormalize bounds to [0,1]', () => {
    const out = robustMinMaxNormalize([10, 20, 30, 100, 5]);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
  });

  it('endStreakRankImproving counts trailing rank improvements', () => {
    expect(endStreakRankImproving([{ rank: 5 }, { rank: 3 }, { rank: 1 }])).toBe(2);
    expect(endStreakRankImproving([{ rank: 1 }, { rank: 1 }])).toBe(0);
  });

  it('endStreakRankDeclining counts trailing rank drops', () => {
    expect(endStreakRankDeclining([{ rank: 2 }, { rank: 5 }, { rank: 8 }])).toBe(2);
  });
});
