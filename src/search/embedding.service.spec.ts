import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMS } from './embedding.constants';
import { EmbeddingService, localTextEmbedding } from './embedding.service';

describe('local embeddings', () => {
  it('is deterministic, normalized, and never uses the network', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const service = new EmbeddingService();
    const first = await service.embedText('示例 Topic 123');
    const second = localTextEmbedding('示例 Topic 123');
    expect(first).toEqual(second);
    expect(first).toHaveLength(EMBEDDING_DIMS);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('returns an all-zero vector for empty text', () => {
    expect(localTextEmbedding('')).toEqual(new Array(EMBEDDING_DIMS).fill(0));
  });
});
