import { describe, expect, it } from 'vitest';
import {
  entityHasRequiredSignals,
  mergePolicyWithTopicKind,
  topicKindStrategyPublic,
} from './topic-kind-policy';
import type { RankingPolicyJson } from './policy-json';

describe('mergePolicyWithTopicKind', () => {
  it('applies OBJECTIVE preset decay when policy omits decay', () => {
    const base: RankingPolicyJson = {
      weights: { streams: 1 },
    };
    const merged = mergePolicyWithTopicKind('OBJECTIVE', base);
    expect(merged.decay?.halfLifeDays).toBe(14);
    expect(merged.weights.streams).toBe(1);
    expect(merged.requiredSignalKeys).toContain('streams');
  });
});

describe('entityHasRequiredSignals', () => {
  const asOf = new Date('2026-05-20T12:00:00Z');

  it('requires all OBJECTIVE keys', () => {
    expect(
      entityHasRequiredSignals(
        [{ metricKey: 'streams', observedAt: asOf }],
        ['streams', 'mentions'],
        asOf,
      ),
    ).toBe(false);
    expect(
      entityHasRequiredSignals(
        [
          { metricKey: 'streams', observedAt: asOf },
          { metricKey: 'mentions', observedAt: asOf },
        ],
        ['streams', 'mentions'],
        asOf,
      ),
    ).toBe(true);
  });
});

describe('topicKindStrategyPublic', () => {
  it('exposes SUBJECTIVE_TREND weights', () => {
    const s = topicKindStrategyPublic('SUBJECTIVE_TREND');
    expect(s.requiredSignalKeys).toEqual(['mentions', 'social']);
    expect(s.weights.social).toBeGreaterThan(s.weights.news);
  });
});
