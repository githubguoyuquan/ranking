import { describe, expect, it, vi } from 'vitest';
import { TopicEntityIntentService } from './topic-entity-intent.service';

describe('topic entity local intent', () => {
  it('removes presentation suffixes without calling a paid model', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(new TopicEntityIntentService().resolve('榜样人物排行榜')).resolves.toEqual({
      category: '榜样人物',
      membership: 'both',
      constraints: [],
      semantic: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps only valid, named Wikidata candidates at the local review boundary', async () => {
    const accepted = await new TopicEntityIntentService().review('任意话题', [
      { externalId: 'Q1', name: 'A', description: '公开资料' },
      { externalId: 'invalid', name: 'B', description: '公开资料' },
      { externalId: 'Q2', name: '  ', description: '公开资料' },
    ]);
    expect(accepted).toEqual(new Set(['Q1']));
  });

  it('rejects a title containing only a ranking suffix', async () => {
    await expect(new TopicEntityIntentService().resolve('排行榜')).rejects.toThrow('缺少对象类别');
  });
});
