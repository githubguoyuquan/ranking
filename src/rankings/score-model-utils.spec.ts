import { describe, expect, it } from 'vitest';
import { stableWeightsFingerprint } from './score-model-utils';

describe('stableWeightsFingerprint', () => {
  it('is order-invariant for keys', () => {
    const a = stableWeightsFingerprint({ streams: 0.35, mentions: 0.25 });
    const b = stableWeightsFingerprint({ mentions: 0.25, streams: 0.35 });
    expect(a).toBe(b);
    expect(a.length).toBe(16);
  });

  it('changes when a weight changes', () => {
    const a = stableWeightsFingerprint({ streams: 0.35 });
    const b = stableWeightsFingerprint({ streams: 0.34 });
    expect(a).not.toBe(b);
  });
});
