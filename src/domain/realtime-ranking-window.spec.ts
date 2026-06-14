import { describe, expect, it } from 'vitest';
import { resolveRealtimeRankingWindow } from './realtime-ranking-window';

describe('resolveRealtimeRankingWindow', () => {
  it('returns sliding 15m window by default', () => {
    const now = new Date('2026-06-12T10:30:45.123Z');
    const w = resolveRealtimeRankingWindow(now, { slidingMinutes: 15 });
    expect(w.timeWindow).toBe('REALTIME');
    expect(w.windowEnd.toISOString()).toBe('2026-06-12T10:30:00.000Z');
    expect(w.windowStart.toISOString()).toBe('2026-06-12T10:15:00.000Z');
    expect(w.semantics.slidingMinutes).toBe(15);
  });
});
