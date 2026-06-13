import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './reciprocal-rank-fusion';

describe('reciprocalRankFusion', () => {
  it('promotes items ranked in multiple lists', () => {
    const fused = reciprocalRankFusion(
      [
        {
          name: 'lexical',
          hits: [{ id: 'a' }, { id: 'b' }],
          idOf: (h) => h.id,
        },
        {
          name: 'vector',
          hits: [{ id: 'b' }, { id: 'c' }],
          idOf: (h) => h.id,
        },
      ],
      60,
    );
    expect(fused[0]?.hit.id).toBe('b');
    expect(fused[0]?.ranks.lexical).toBe(2);
    expect(fused[0]?.ranks.vector).toBe(1);
  });
});
