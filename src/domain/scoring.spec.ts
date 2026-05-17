import { describe, expect, it } from 'vitest';
import { robustMinMaxNormalize, timeWeight } from './scoring';

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
});
