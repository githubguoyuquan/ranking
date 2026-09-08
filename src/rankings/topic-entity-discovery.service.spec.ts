import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopicEntityDiscoveryService } from './topic-entity-discovery.service';

const row = (qid: string, name = '真实来源名称') => ({ item: { value: `http://www.wikidata.org/entity/${qid}` }, itemLabel: { value: name }, itemDescription: { value: '来源描述' } });
const service = new TopicEntityDiscoveryService();
afterEach(() => vi.unstubAllGlobals());

describe('Wikidata topic discovery', () => {
  it('enforces football, nationality and gender in the source query, returns canonical identity', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ results: { bindings: [row('Q1')] } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await service.discover({ title: '中国女子足球球星榜', locale: 'zh-CN', count: 1 });
    const query = new URL(fetcher.mock.calls[0][0]).searchParams.get('query');
    expect(query).toContain('wd:Q937857');
    expect(query).toContain('wdt:P2446 ?playerProfile');
    expect(query).toContain('REGEX(STR(?profession), "football|soccer", "i")');
    expect(query).toContain('wdt:P27 wd:Q148');
    expect(query).toContain('wdt:P21 wd:Q6581072');
    expect(query).toContain('zh-hans,zh,zh-hant,en');
    expect(result.entities[0]).toMatchObject({ externalId: 'Q1', type: 'PERSON', sourceUrl: 'https://www.wikidata.org/wiki/Q1' });
  });

  it('keeps real partial results, deduplicates source IDs and drops malformed rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ results: { bindings: [row('Q1'), row('Q1'), row('Q2', 'Q2'), row('invalid'), row('Q3')] } })));
    const result = await service.discover({ title: '全球女歌手榜', locale: 'zh-CN', count: 5 });
    expect(result.entities.map((item) => item.externalId)).toEqual(['Q1', 'Q3']);
    expect(result.warning).toContain('不包含指标数据');
  });

  it('does not silently interpret ambiguous ball stars as football or ignore unsupported constraints', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ search: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.discover({ title: '球星榜', locale: 'zh-CN', count: 2 })).rejects.toThrow(BadRequestException);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(service.discover({ title: '现役NBA篮球球星榜', locale: 'zh-CN', count: 2 })).rejects.toThrow('无法准确识别');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new URL(fetcher.mock.calls[0][0]).hostname).toBe('www.wikidata.org');
  });

  it('uses an exact class match for unfamiliar categories, rejecting fuzzy-only results', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ search: [{ id: 'Q500', label: '机器人' }] }))
      .mockResolvedValueOnce(Response.json({ results: { bindings: [row('Q11')] } }));
    vi.stubGlobal('fetch', fetcher);
    expect((await service.discover({ title: '机器人榜', locale: 'zh-CN', count: 1 })).entities).toHaveLength(1);
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('query')).toContain('wd:Q500');
    fetcher.mockResolvedValueOnce(Response.json({ search: [{ id: 'Q500', label: '其他机器人' }] }));
    await expect(service.discover({ title: '机器人榜', locale: 'zh-CN', count: 1 })).rejects.toThrow(BadRequestException);
  });

  it('reports timeout/unavailable sources without making up identities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(service.discover({ title: '足球榜', locale: 'zh-CN', count: 3 })).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects empty sources and invalid counts', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ results: { bindings: [] } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.discover({ title: '足球榜', locale: 'zh-CN', count: 1 })).rejects.toThrow('没有找到');
    await expect(service.discover({ title: '足球榜', locale: 'zh-CN', count: 51 })).rejects.toThrow(BadRequestException);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
