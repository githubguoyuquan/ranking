import { describe, expect, it, vi } from 'vitest';
import { HybridSearchService } from './hybrid-search.service';

describe('HybridSearchService', () => {
  it('parseQuery strips DSL tokens', () => {
    const svc = new HybridSearchService({} as never, {} as never, {} as never, {} as never);
    const parsed = svc.parseQuery('type:PERSON taylor', { since: '7d' });
    expect(parsed.text).toBe('taylor');
    expect(parsed.filters.type).toBe('PERSON');
    expect(parsed.filters.since).toBeInstanceOf(Date);
  });

  it('searchEntities hybrid fuses lexical and vector', async () => {
    const elastic = {
      isEnabled: () => true,
      searchEntities: vi.fn().mockResolvedValue([
        { entityId: '1', score: 1, canonicalName: 'A', type: 'PERSON', match: 'lexical' },
        { entityId: '2', score: 0.5, canonicalName: 'B', type: 'PERSON', match: 'lexical' },
      ]),
      searchEntitiesByVector: vi.fn().mockResolvedValue([
        { entityId: '2', score: 0.9, canonicalName: 'B', type: 'PERSON', match: 'vector' },
      ]),
    };
    const embedding = {
      isConfigured: () => true,
      embedText: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    };
    const prisma = {
      entity: { findMany: vi.fn().mockResolvedValue([]) },
      topic: { findFirst: vi.fn() },
      topicVersion: { findFirst: vi.fn() },
      rankingItemHistory: { findMany: vi.fn() },
    };
    const svc = new HybridSearchService(
      prisma as never,
      elastic as never,
      { isEnabled: () => false } as never,
      embedding as never,
    );
    const parsed = svc.parseQuery('test', {});
    const out = await svc.searchEntities({
      parsed,
      limit: 5,
      engine: 'elasticsearch',
      hybrid: true,
    });
    expect(out.mode).toBe('hybrid');
    expect(out.hits[0]?.entityId).toBe('2');
    expect(out.hits[0]?.match).toBe('hybrid');
  });
});
