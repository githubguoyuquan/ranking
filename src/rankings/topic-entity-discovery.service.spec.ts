import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicEntityDiscoveryService } from './topic-entity-discovery.service';

const row = (qid: string, name = '来源对象名称') => ({ item: { value: `http://www.wikidata.org/entity/${qid}` }, itemLabel: { value: name }, itemDescription: { value: '来源描述' } });
const service = new TopicEntityDiscoveryService();
beforeEach(() => {
  vi.stubEnv('ENTITY_DISCOVERY_HTTP_PROXY', '');
  vi.stubEnv('CRAWL_HTTP_PROXY', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('domain-independent Wikidata discovery', () => {
  it.each([['任意类别甲', 'Q812345'], ['任意类别乙', 'Q934567']])('resolves %s only from external search data', async (label, id) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [{ id, label }] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [row('Q1')] } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await service.discover({ title: label + '榜', locale: 'zh-CN', count: 1 });
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('search')).toBe(label);
    const query = new URL(fetcher.mock.calls[1][0]).searchParams.get('query')!;
    expect(query).toContain(`wd:${id}`);
    expect(query).toContain('wdt:P31/wdt:P279*');
    expect(query).toContain('wdt:P106/wdt:P279*');
    expect(query).toContain('zh-hans,zh,zh-hant,en');
    expect(query.match(/wd:Q[0-9]+/g)).toEqual([`wd:${id}`, `wd:${id}`]);
    expect(result.entities[0]).toMatchObject({ externalId: 'Q1', type: 'ENTITY', sourceUrl: 'https://www.wikidata.org/wiki/Q1' });
    expect(result.strategy).toContain('完整名称精确匹配');
  });

  it('keeps real partial results without padding and deduplicates source identities', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [{ id: 'Q500', label: '自定义类别' }] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [row('Q1'), row('Q1'), row('Q2', 'Q2'), row('invalid'), row('Q3')] } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await service.discover({ title: '自定义类别榜', locale: 'zh-CN', count: 5 });
    expect(result.entities.map(item => item.externalId)).toEqual(['Q1', 'Q3']);
  });

  it('preserves qualifiers and never falls back to a broader fuzzy match', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ search: [{ id: 'Q500', label: '某类对象' }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.discover({ title: '某地区当前某类对象榜', locale: 'zh-CN', count: 2 })).rejects.toThrow('无法唯一匹配');
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('search')).toBe('某地区当前某类对象');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('accepts a unique exact source alias, but rejects ambiguous and unsafe IDs', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [{ id: 'Q500', label: '类别标准名', match: { text: '类别别名' } }] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [row('Q11')] } }));
    vi.stubGlobal('fetch', fetcher);
    expect((await service.discover({ title: '类别别名榜', locale: 'zh-CN', count: 1 })).entities).toHaveLength(1);
    fetcher.mockResolvedValueOnce(Response.json({ search: [{ id: 'Q1', label: '类别' }, { id: 'Q2', label: '类别' }] }));
    await expect(service.discover({ title: '类别榜', locale: 'zh-CN', count: 1 })).rejects.toThrow(BadRequestException);
    fetcher.mockResolvedValueOnce(Response.json({ search: [{ id: 'Q1 } SERVICE <https://evil.test> {', label: '类别' }] }));
    await expect(service.discover({ title: '类别榜', locale: 'zh-CN', count: 1 })).rejects.toThrow(BadRequestException);
  });

  it('removes only a final presentation suffix, preserving business text in the middle', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ search: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.discover({ title: '榜样人物榜', locale: 'zh-CN', count: 1 })).rejects.toThrow(BadRequestException);
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('search')).toBe('榜样人物');
  });

  it('reports unavailable sources without inventing identities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(service.discover({ title: '类别榜', locale: 'zh-CN', count: 3 })).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects empty results and invalid counts before sourcing', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [{ id: 'Q500', label: '类别' }] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [] } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.discover({ title: '类别榜', locale: 'zh-CN', count: 1 })).rejects.toThrow('没有找到');
    await expect(service.discover({ title: '类别榜', locale: 'zh-CN', count: 51 })).rejects.toThrow(BadRequestException);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
