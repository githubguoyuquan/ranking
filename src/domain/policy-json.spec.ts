import { describe, expect, it } from 'vitest';
import { parseRankingPolicyJson } from './policy-json';

describe('parseRankingPolicyJson', () => {
  it('accepts minimal weights', () => {
    const p = parseRankingPolicyJson({
      weights: { streams: 0.5, news: 0.5 },
    });
    expect(p.weights).toEqual({ streams: 0.5, news: 0.5 });
  });

  it('coerces numeric strings in weights', () => {
    const p = parseRankingPolicyJson({
      weights: { a: '0.25', b: 0.75 },
    } as unknown);
    expect(p.weights).toEqual({ a: 0.25, b: 0.75 });
  });

  it('rejects negative weight', () => {
    expect(() =>
      parseRankingPolicyJson({ weights: { x: -1 } }),
    ).toThrow(/non-negative/);
  });

  it('validates entityIds as decimal strings', () => {
    expect(() =>
      parseRankingPolicyJson({
        weights: { a: 1 },
        entityIds: ['12', 'bad'],
      }),
    ).toThrow(/invalid entityId/);
  });

  it('requires requiredSignalKeys ⊆ weights', () => {
    expect(() =>
      parseRankingPolicyJson({
        weights: { streams: 1 },
        requiredSignalKeys: ['mentions'],
      }),
    ).toThrow(/not in weights/);
  });

  it('accepts decay.halfLifeDays', () => {
    const p = parseRankingPolicyJson({
      weights: { a: 1 },
      decay: { halfLifeDays: 21 },
    });
    expect(p.decay?.halfLifeDays).toBe(21);
  });

  it('preserves validated dynamic metric definitions', () => {
    const parsed = parseRankingPolicyJson({
      weights: { result_quality: 1 },
      metricDefinitions: [{
        key: 'result_quality',
        label: '结果质量',
        description: '衡量结果。',
        normalizationGuide: '换算为 0–100。',
        sourceHints: ['公开权威记录'],
      }],
    });
    expect(parsed.metricDefinitions?.[0].key).toBe('result_quality');
    expect(() => parseRankingPolicyJson({
      weights: { result_quality: 1 },
      metricDefinitions: [{
        key: 'unrelated', label: 'x', description: 'x',
        normalizationGuide: 'x', sourceHints: [],
      }],
    })).toThrow('unknown key');
  });
});
