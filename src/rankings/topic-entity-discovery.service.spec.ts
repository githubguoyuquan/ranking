import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicEntityDiscoveryService } from './topic-entity-discovery.service';

const row = (qid: string, name = '来源对象名称') => ({
  item: { value: `http://www.wikidata.org/entity/${qid}` },
  itemLabel: { value: name },
  itemDescription: { value: '公开来源描述' },
});
const exact = (id: string, label: string) => ({ id, label });

beforeEach(() => {
  vi.stubEnv('ENTITY_DISCOVERY_HTTP_PROXY', '');
  vi.stubEnv('CRAWL_HTTP_PROXY', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('domain-independent topic entity discovery', () => {
  it('builds a source query only from the runtime semantic plan and verified Wikidata IDs', async () => {
    const intent = {
      resolve: vi.fn().mockResolvedValue({
        category: 'runtime category',
        membership: 'occupation',
        constraints: [{ property: 'runtime property', value: 'runtime value' }],
        semantic: true,
      }),
      review: vi.fn().mockResolvedValue(new Set(['Q1'])),
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [exact('Q812345', 'runtime category')] }))
      .mockResolvedValueOnce(Response.json({ search: [exact('P27', 'runtime property')] }))
      .mockResolvedValueOnce(Response.json({ search: [exact('Q934567', 'runtime value')] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [row('Q1'), row('Q2')] } }));
    vi.stubGlobal('fetch', fetcher);
    const service = new TopicEntityDiscoveryService(intent as never);
    const result = await service.discover({ title: '任意业务话题', locale: 'zh-CN', count: 2 });

    expect(intent.resolve).toHaveBeenCalledWith('任意业务话题');
    expect(fetcher.mock.calls.slice(0, 3).map((call) =>
      new URL(call[0]).searchParams.get('search'))).toEqual([
      'runtime category', 'runtime property', 'runtime value',
    ]);
    const query = new URL(fetcher.mock.calls[3][0]).searchParams.get('query')!;
    expect(query).toContain('wd:Q812345');
    expect(query).toContain('wdt:P27 wd:Q934567');
    expect(query).toContain('wdt:P106/wdt:P279*');
    expect(query).toContain('zh-hans,zh,zh-hant,en');
    expect(intent.review).toHaveBeenCalledWith('任意业务话题', expect.arrayContaining([
      expect.objectContaining({ externalId: 'Q1' }),
      expect.objectContaining({ externalId: 'Q2' }),
    ]));
    expect(result.entities.map((item) => item.externalId)).toEqual(['Q1']);
    expect(result.strategy).toContain('OpenAI 语义解析');
  });

  it.each([
    ['instance', 'wdt:P31/wdt:P279*', 'ENTITY'],
    ['occupation', 'wdt:P106/wdt:P279*', 'PERSON'],
    ['both', 'UNION', 'ENTITY'],
  ] as const)('supports generic %s membership without a business-category dictionary', async (membership, fragment, type) => {
    const intent = {
      resolve: vi.fn().mockResolvedValue({
        category: 'category supplied at runtime', membership, constraints: [], semantic: true,
      }),
      review: vi.fn().mockResolvedValue(new Set(['Q7'])),
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [exact('Q700', 'category supplied at runtime')] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [row('Q7')] } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await new TopicEntityDiscoveryService(intent as never)
      .discover({ title: '任意话题', locale: 'en', count: 1 });
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('query')).toContain(fragment);
    expect(result.entities[0].type).toBe(type);
  });

  it('keeps partial reviewed results, deduplicates source IDs and never pads a roster', async () => {
    const intent = {
      resolve: vi.fn().mockResolvedValue({
        category: 'runtime category', membership: 'both', constraints: [], semantic: true,
      }),
      review: vi.fn().mockResolvedValue(new Set(['Q1', 'Q3'])),
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [exact('Q500', 'runtime category')] }))
      .mockResolvedValueOnce(Response.json({
        results: { bindings: [row('Q1'), row('Q1'), row('Q2', 'Q2'), row('invalid'), row('Q3')] },
      }));
    vi.stubGlobal('fetch', fetcher);
    const result = await new TopicEntityDiscoveryService(intent as never)
      .discover({ title: '任意话题', locale: 'zh-CN', count: 5 });
    expect(result.entities.map((item) => item.externalId)).toEqual(['Q1', 'Q3']);
  });

  it('requires unique exact provider identities and rejects unsafe IDs', async () => {
    const intent = {
      resolve: vi.fn().mockResolvedValue({
        category: 'category', membership: 'both', constraints: [], semantic: true,
      }),
      review: vi.fn(),
    };
    const service = new TopicEntityDiscoveryService(intent as never);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({
      search: [exact('Q1', 'category'), exact('Q2', 'category')],
    }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.discover({ title: 'topic', locale: 'en', count: 1 }))
      .rejects.toThrow(BadRequestException);

    fetcher.mockResolvedValueOnce(Response.json({
      search: [exact('Q1 } SERVICE <https://evil.test> {', 'category')],
    }));
    await expect(service.discover({ title: 'topic', locale: 'en', count: 1 }))
      .rejects.toThrow(BadRequestException);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(intent.review).not.toHaveBeenCalled();
  });

  it('reports unavailable providers and an empty reviewed roster without inventing identities', async () => {
    const intent = {
      resolve: vi.fn().mockResolvedValue({
        category: 'category', membership: 'instance', constraints: [], semantic: true,
      }),
      review: vi.fn().mockResolvedValue(new Set()),
    };
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'));
    vi.stubGlobal('fetch', fetcher);
    const service = new TopicEntityDiscoveryService(intent as never);
    await expect(service.discover({ title: 'topic', locale: 'en', count: 1 }))
      .rejects.toThrow(ServiceUnavailableException);

    fetcher
      .mockResolvedValueOnce(Response.json({ search: [exact('Q500', 'category')] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [row('Q1')] } }));
    await expect(service.discover({ title: 'topic', locale: 'en', count: 1 }))
      .rejects.toThrow('没有找到能确认符合');
  });

  it('rejects invalid input before calling semantic or source providers', async () => {
    const intent = { resolve: vi.fn(), review: vi.fn() };
    const service = new TopicEntityDiscoveryService(intent as never);
    await expect(service.discover({ title: '', locale: 'en', count: 1 }))
      .rejects.toThrow(BadRequestException);
    await expect(service.discover({ title: 'topic', locale: 'en', count: 51 }))
      .rejects.toThrow(BadRequestException);
    expect(intent.resolve).not.toHaveBeenCalled();
  });

  it('labels the no-key exact-match fallback honestly', async () => {
    const intent = {
      resolve: vi.fn().mockResolvedValue({
        category: 'runtime category', membership: 'both', constraints: [], semantic: false,
      }),
      review: vi.fn().mockResolvedValue(new Set(['Q1'])),
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [exact('Q500', 'runtime category')] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [row('Q1')] } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await new TopicEntityDiscoveryService(intent as never)
      .discover({ title: '任意话题', locale: 'en', count: 1 });
    expect(result.strategy).toContain('完整名称精确匹配');
    expect(result.strategy).not.toContain('OpenAI');
    expect(result.warning).toContain('未配置语义服务');
  });
});
