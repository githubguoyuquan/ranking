import { describe, expect, it } from 'vitest';
import { nextEntityTopicStats } from './entity-topic-stats';

describe('nextEntityTopicStats', () => {
  const asOf = new Date('2026-05-01T00:00:00.000Z');

  it('initializes on first point', () => {
    const n = nextEntityTopicStats({ prev: null, newRank: 5, asOf });
    expect(n).toMatchObject({
      bestRank: 5,
      worstRank: 5,
      currentStreakUp: 0,
      currentStreakDown: 0,
      lastRank: 5,
    });
  });

  it('increments improving streak when rank number drops', () => {
    const n = nextEntityTopicStats({
      prev: {
        bestRank: 8,
        worstRank: 8,
        currentStreakUp: 1,
        currentStreakDown: 0,
        lastRank: 8,
      },
      newRank: 5,
      asOf,
    });
    expect(n.currentStreakUp).toBe(2);
    expect(n.currentStreakDown).toBe(0);
    expect(n.bestRank).toBe(5);
  });
});
