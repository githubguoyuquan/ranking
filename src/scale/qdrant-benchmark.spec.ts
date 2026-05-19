import { describe, expect, it, vi } from 'vitest';
import { QdrantBenchmarkService } from './qdrant-benchmark.service';
import type { QdrantSearchService } from '../search/qdrant-search.service';

describe('QdrantBenchmarkService', () => {
  it('returns disabled when Qdrant off', async () => {
    const qdrant = {
      isEnabled: () => false,
      ping: vi.fn(),
      searchEntities: vi.fn(),
      searchEntitiesByVector: vi.fn(),
    } as unknown as QdrantSearchService;
    const svc = new QdrantBenchmarkService(qdrant);
    const r = await svc.run({ iterations: 5 });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('QDRANT_URL');
  });
});
