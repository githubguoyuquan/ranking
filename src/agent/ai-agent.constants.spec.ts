import { describe, expect, it } from 'vitest';
import {
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_RANKING_V1,
  AI_AGENT_RULES_V1,
  AI_AGENT_TREND_ANALYSIS_V1,
  AI_AGENT_TREND_V1,
  AI_AGENT_TOPIC_DISCOVERY_V1,
  parseFollowupAnalyzePipeline,
  parseOrchestrationPipeline,
  parseSnapshotPostProcessPipeline,
  resolveAiAnalysisAgentKind,
} from './ai-agent.constants';

describe('resolveAiAnalysisAgentKind', () => {
  it('maps known agent names', () => {
    expect(resolveAiAnalysisAgentKind(AI_AGENT_RULES_V1)).toBe('default');
    expect(resolveAiAnalysisAgentKind(` ${AI_AGENT_POST_SNAPSHOT_SUMMARY_V1} `)).toBe(
      'followup',
    );
    expect(resolveAiAnalysisAgentKind(AI_AGENT_TREND_V1)).toBe('trend');
    expect(resolveAiAnalysisAgentKind(AI_AGENT_CREDIBILITY_V1)).toBe('credibility');
    expect(resolveAiAnalysisAgentKind(AI_AGENT_TREND_ANALYSIS_V1)).toBe('trend_analysis');
    expect(resolveAiAnalysisAgentKind(AI_AGENT_RANKING_V1)).toBe('ranking');
  });

  it('treats unknown as default', () => {
    expect(resolveAiAnalysisAgentKind('custom-agent')).toBe('default');
  });
});

describe('parseSnapshotPostProcessPipeline', () => {
  it('preserves order and filters unknown', () => {
    const r = parseSnapshotPostProcessPipeline(
      ` ${AI_AGENT_TREND_V1} , bogus , ${AI_AGENT_POST_SNAPSHOT_SUMMARY_V1} , fact-check-v1 , trend-analysis-v1 `,
    );
    expect(r.agents).toEqual([
      AI_AGENT_TREND_V1,
      AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
      'fact-check-v1',
      AI_AGENT_TREND_ANALYSIS_V1,
    ]);
    expect(r.unknown).toEqual(['bogus']);
  });

  it('allows rules-v1 in pipeline', () => {
    const r = parseSnapshotPostProcessPipeline(`${AI_AGENT_RULES_V1},${AI_AGENT_CREDIBILITY_V1}`);
    expect(r.agents).toEqual([AI_AGENT_RULES_V1, AI_AGENT_CREDIBILITY_V1]);
    expect(r.unknown).toEqual([]);
  });
});

describe('parseFollowupAnalyzePipeline', () => {
  it('delegates to snapshot post-process parser', () => {
    const r = parseFollowupAnalyzePipeline(`${AI_AGENT_TREND_V1},${AI_AGENT_POST_SNAPSHOT_SUMMARY_V1}`);
    expect(r.agents).toEqual([AI_AGENT_TREND_V1, AI_AGENT_POST_SNAPSHOT_SUMMARY_V1]);
  });
});

describe('parseOrchestrationPipeline', () => {
  it('includes topic lifecycle agents', () => {
    const r = parseOrchestrationPipeline(
      `${AI_AGENT_TOPIC_DISCOVERY_V1},not-real,${AI_AGENT_CREDIBILITY_V1}`,
    );
    expect(r.agents).toEqual([
      AI_AGENT_TOPIC_DISCOVERY_V1,
      AI_AGENT_CREDIBILITY_V1,
    ]);
    expect(r.unknown).toEqual(['not-real']);
  });
});
