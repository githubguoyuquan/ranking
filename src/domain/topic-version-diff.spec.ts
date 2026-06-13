import { describe, expect, it } from 'vitest';
import { diffTopicVersionPolicies } from './topic-version-diff';

describe('diffTopicVersionPolicies', () => {
  it('detects weight and entity list changes', () => {
    const diff = diffTopicVersionPolicies(
      {
        weights: { streams: 0.5, mentions: 0.5 },
        entityIds: ['1', '2'],
        requiredSignalKeys: ['streams'],
      },
      {
        weights: { streams: 0.6, social: 0.4 },
        entityIds: ['2', '3'],
        requiredSignalKeys: ['streams', 'social'],
        decay: { halfLifeDays: 14 },
      },
    );

    expect(diff.unchanged).toBe(false);
    expect(diff.weightChanges.some((c) => c.key === 'streams' && c.kind === 'changed')).toBe(true);
    expect(diff.weightChanges.some((c) => c.key === 'mentions' && c.kind === 'removed')).toBe(true);
    expect(diff.weightChanges.some((c) => c.key === 'social' && c.kind === 'added')).toBe(true);
    expect(diff.entityIdsAdded).toEqual(['3']);
    expect(diff.entityIdsRemoved).toEqual(['1']);
    expect(diff.requiredSignalKeysAdded).toEqual(['social']);
    expect(diff.decayChanged).toBe(true);
  });

  it('reports unchanged when policies match', () => {
    const policy = {
      weights: { streams: 0.5, mentions: 0.5 },
      entityIds: ['1'],
    };
    expect(diffTopicVersionPolicies(policy, { ...policy }).unchanged).toBe(true);
  });
});
