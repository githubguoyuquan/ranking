import { describe, expect, it } from 'vitest';
import { AGENT_REGISTRY, listAgentRegistry } from './agent-registry';
import {
  AI_AGENT_RANKING_V1,
  AI_AGENT_TREND_ANALYSIS_V1,
} from './ai-agent.constants';

describe('agent-registry', () => {
  it('lists 11 agents', () => {
    expect(listAgentRegistry()).toHaveLength(11);
    expect(AGENT_REGISTRY.length).toBe(11);
  });

  it('includes new snapshot agents', () => {
    const ids = listAgentRegistry().map((a) => a.id);
    expect(ids).toContain(AI_AGENT_TREND_ANALYSIS_V1);
    expect(ids).toContain(AI_AGENT_RANKING_V1);
  });
});
