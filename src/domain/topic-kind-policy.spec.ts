import { describe, expect, it } from 'vitest';
import { mergePolicyWithTopicKind } from './topic-kind-policy';
import type { RankingPolicyJson } from './policy-json';

describe('mergePolicyWithTopicKind', () => {
  it('applies OBJECTIVE preset decay when policy omits decay', () => {
    const base: RankingPolicyJson = {
      weights: { streams: 1 },
    };
    const merged = mergePolicyWithTopicKind('OBJECTIVE', base);
    expect(merged.decay?.halfLifeDays).toBe(14);
    expect(merged.weights.streams).toBe(1);
  });
});
