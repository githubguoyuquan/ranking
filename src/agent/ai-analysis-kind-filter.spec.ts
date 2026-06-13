import { describe, expect, it } from 'vitest';
import { buildAiAnalysisAgentKindFilter } from './ai-analysis-kind-filter';

describe('buildAiAnalysisAgentKindFilter', () => {
  it('builds trend_analysis OR clause', () => {
    const w = buildAiAnalysisAgentKindFilter('trend_analysis');
    expect(w.OR).toBeDefined();
    expect(Array.isArray(w.OR)).toBe(true);
  });

  it('builds default NOT clause', () => {
    const w = buildAiAnalysisAgentKindFilter('default');
    expect(w.NOT).toBeDefined();
  });
});
