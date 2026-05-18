import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMS } from '../search/embedding.constants';
import { findNearestByCosine } from './crawl-semantic-dedup';

function padVec(head: number[]): number[] {
  const out = Array<number>(EMBEDDING_DIMS).fill(0);
  for (let i = 0; i < Math.min(head.length, EMBEDDING_DIMS); i++) {
    out[i] = head[i]!;
  }
  return out;
}

describe('findNearestByCosine', () => {
  it('returns null when nothing meets threshold', () => {
    const vec = padVec([1, 0, 0]);
    const rows = [
      {
        id: 1n,
        previewEmbedding: padVec([0, 1, 0]),
      },
    ];
    expect(findNearestByCosine(vec, rows, 0.99)).toBeNull();
  });

  it('returns id with highest similarity above threshold', () => {
    const vec = padVec([1, 0, 0]);
    const rows = [
      { id: 1n, previewEmbedding: padVec([1, 0, 0]) },
      { id: 2n, previewEmbedding: padVec([0.9, 0.1, 0]) },
    ];
    expect(findNearestByCosine(vec, rows, 0.85)).toBe(1n);
  });
});
