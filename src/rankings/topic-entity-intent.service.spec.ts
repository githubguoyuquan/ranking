import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicEntityIntentService } from './topic-entity-intent.service';

function completion(content: unknown) {
  return Response.json({
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify(content), refusal: null },
    }],
  });
}

beforeEach(() => {
  vi.stubEnv('ENTITY_DISCOVERY_HTTP_PROXY', '');
  vi.stubEnv('CRAWL_HTTP_PROXY', '');
  vi.stubEnv('OPENAI_API_KEY', 'test-secret-key');
  vi.stubEnv('ENTITY_DISCOVERY_MODEL', 'test-structured-model');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('topic entity semantic intent', () => {
  it('sends only the authorized topic field and accepts strict structured intent', async () => {
    const fetcher = vi.fn().mockResolvedValue(completion({
      category: 'runtime category',
      membership: 'occupation',
      constraints: [{ property: 'country of citizenship', value: 'runtime country' }],
      unresolved: [],
    }));
    vi.stubGlobal('fetch', fetcher);
    const result = await new TopicEntityIntentService().resolve('用户的任意业务话题');

    expect(result).toEqual({
      category: 'runtime category',
      membership: 'occupation',
      constraints: [{ property: 'country of citizenship', value: 'runtime country' }],
      semantic: true,
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-secret-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('test-structured-model');
    expect(body.store).toBe(false);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'topic_entity_intent', strict: true },
    });
    expect(JSON.parse(body.messages[1].content)).toEqual({ topic: '用户的任意业务话题' });
    expect(body.messages[1].content).not.toContain('tenant');
    expect(body.messages[1].content).not.toContain('metric');
  });

  it('does not silently drop unresolved or unsupported topic restrictions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({
      category: 'runtime category',
      membership: 'instance',
      constraints: [],
      unresolved: ['current season requires a time-qualified statement'],
    })));
    await expect(new TopicEntityIntentService().resolve('任意复杂话题'))
      .rejects.toThrow('范围尚不能可靠转换');
  });

  it('sends only public candidate identity fields and returns an offered-ID subset', async () => {
    const fetcher = vi.fn().mockResolvedValue(completion({ acceptedIds: ['Q2'] }));
    vi.stubGlobal('fetch', fetcher);
    const candidates = [
      { externalId: 'Q1', name: 'A', description: '公开简介 A' },
      { externalId: 'Q2', name: 'B', description: '公开简介 B' },
    ];
    const accepted = await new TopicEntityIntentService().review('任意话题', candidates);
    expect([...accepted]).toEqual(['Q2']);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(JSON.parse(body.messages[1].content)).toEqual({
      topic: '任意话题',
      candidates: [
        { id: 'Q1', name: 'A', publicDescription: '公开简介 A' },
        { id: 'Q2', name: 'B', publicDescription: '公开简介 B' },
      ],
    });
    expect(body.response_format.json_schema.name).toBe('topic_entity_review');
  });

  it('rejects hallucinated candidate IDs and malformed structured data', async () => {
    const service = new TopicEntityIntentService();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(completion({ acceptedIds: ['Q999'] }))
      .mockResolvedValueOnce(completion({
        category: 'x', membership: 'not-valid', constraints: [], unresolved: [],
      }));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.review('topic', [
      { externalId: 'Q1', name: 'A', description: 'public' },
    ])).rejects.toThrow('来源之外');
    await expect(service.resolve('topic')).rejects.toThrow(BadRequestException);
  });

  it('surfaces refusal and provider failure without falling back to invented entities', async () => {
    const service = new TopicEntityIntentService();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'refused' } }],
      }))
      .mockRejectedValueOnce(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetcher);
    await expect(service.resolve('topic')).rejects.toThrow(ServiceUnavailableException);
    await expect(service.resolve('topic')).rejects.toThrow(ServiceUnavailableException);
  });

  it('uses an explicit exact-match fallback when no API key is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const service = new TopicEntityIntentService();
    await expect(service.resolve('榜样人物榜')).resolves.toEqual({
      category: '榜样人物',
      membership: 'both',
      constraints: [],
      semantic: false,
    });
    expect(await service.review('topic', [
      { externalId: 'Q1', name: 'A', description: 'public' },
    ])).toEqual(new Set(['Q1']));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
