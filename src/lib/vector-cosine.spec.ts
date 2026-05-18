import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './vector-cosine';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns 0 for length mismatch', () => {
    expect(cosineSimilarity([1], [1, 0])).toBe(0);
  });
});
