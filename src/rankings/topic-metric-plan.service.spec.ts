import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicMetricPlanService } from './topic-metric-plan.service';

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
  vi.stubEnv('METRIC_PLANNING_MODEL', 'test-structured-model');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('topic metric planning', () => {
  it('uses only topic context and normalizes a topic-specific metric plan', async () => {
    const fetcher = vi.fn().mockResolvedValue(completion({
      rationale: '适用于这个运行时话题。',
      metrics: [
        {
          key: 'outcome_quality',
          label: '结果质量',
          description: '衡量结果质量。',
          normalizationGuide: '在同一批候选中按百分位换算。',
          sourceHints: ['公开权威记录'],
          weight: 3,
          required: true,
        },
        {
          key: 'peer_recognition',
          label: '同行认可',
          description: '衡量同行认可。',
          normalizationGuide: '按同一时间窗的有效记录换算。',
          sourceHints: ['公开行业档案'],
          weight: 1,
          required: false,
        },
      ],
    }));
    vi.stubGlobal('fetch', fetcher);

    const result = await new TopicMetricPlanService().suggest({
      title: '用户的任意业务话题',
      kind: 'SEMI_OBJECTIVE',
      locale: 'zh-CN',
    });

    expect(result.metrics.map((metric) => [metric.key, metric.weight])).toEqual([
      ['outcome_quality', 0.75],
      ['peer_recognition', 0.25],
    ]);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'topic_metric_plan', strict: true },
    });
    expect(JSON.parse(body.messages[1].content)).toEqual({
      topic: '用户的任意业务话题',
      topicKind: 'SEMI_OBJECTIVE',
      locale: 'zh-CN',
    });
    expect(body.messages[1].content).not.toContain('tenant');
    expect(body.messages[1].content).not.toContain('entity');
  });

  it('rejects duplicate keys and refuses a fixed fallback without an API key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion({
      rationale: 'duplicate',
      metrics: [
        {
          key: 'same_key', label: 'A', description: 'A', normalizationGuide: 'A',
          sourceHints: ['A'], weight: 0.5, required: true,
        },
        {
          key: 'same_key', label: 'B', description: 'B', normalizationGuide: 'B',
          sourceHints: ['B'], weight: 0.5, required: false,
        },
      ],
    })));
    const service = new TopicMetricPlanService();
    await expect(service.suggest({ title: 'topic', kind: 'OBJECTIVE', locale: 'en' }))
      .rejects.toThrow('重复指标');

    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(service.suggest({ title: 'topic', kind: 'OBJECTIVE', locale: 'en' }))
      .rejects.toThrow(ServiceUnavailableException);
  });
});
