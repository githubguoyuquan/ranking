import { describe, expect, it, vi } from 'vitest';
import { TopicMetricPlanService } from './topic-metric-plan.service';

describe('topic metric local planning', () => {
  it('creates a normalized evidence plan without any network request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await new TopicMetricPlanService().suggest({
      title: '用户的任意业务话题',
      kind: 'SEMI_OBJECTIVE',
      locale: 'zh-CN',
    });
    expect(result.generatedBy).toBe('local_algorithm');
    expect(result.metrics.map((metric) => metric.key)).toEqual([
      'documented_achievement',
      'independent_recognition',
      'evidence_quality',
    ]);
    expect(result.metrics.reduce((sum, metric) => sum + metric.weight, 0)).toBe(1);
    expect(JSON.stringify(result)).not.toContain('streams');
    expect(fetcher).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('changes the evidence plan according to the declared topic kind', async () => {
    const service = new TopicMetricPlanService();
    const objective = await service.suggest({ title: 'A', kind: 'OBJECTIVE', locale: 'en' });
    const trend = await service.suggest({ title: 'A', kind: 'SUBJECTIVE_TREND', locale: 'en' });
    expect(objective.metrics.map((metric) => metric.key)).not.toEqual(
      trend.metrics.map((metric) => metric.key),
    );
  });
});
