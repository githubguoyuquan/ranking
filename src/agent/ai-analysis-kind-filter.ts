import type { Prisma } from '@prisma/client';
import {
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_FACT_CHECK_V1,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_RANKING_V1,
  AI_AGENT_TREND_ANALYSIS_V1,
  AI_AGENT_TREND_V1,
  AI_AGENT_TIME_SERIES_V1,
  type ListAnalysesAgentKind,
} from './ai-agent.constants';

function kindOrClause(
  agent: string,
  agentKind: string,
): Prisma.AiAnalysisWhereInput {
  return {
    OR: [
      { agent },
      { detailJson: { path: ['agentKind'], equals: agentKind } },
    ],
  };
}

const EXCLUDED_FROM_DEFAULT: Prisma.AiAnalysisWhereInput[] = [
  kindOrClause(AI_AGENT_POST_SNAPSHOT_SUMMARY_V1, 'followup'),
  kindOrClause(AI_AGENT_TREND_V1, 'trend'),
  kindOrClause(AI_AGENT_CREDIBILITY_V1, 'credibility'),
  kindOrClause(AI_AGENT_FACT_CHECK_V1, 'factcheck'),
  kindOrClause(AI_AGENT_TREND_ANALYSIS_V1, 'trend_analysis'),
  kindOrClause(AI_AGENT_TIME_SERIES_V1, 'timeseries'),
  kindOrClause(AI_AGENT_RANKING_V1, 'ranking'),
];

/** 将 `agentKind` 查询参数转为 Prisma where 片段（不含 snapshotId） */
export function buildAiAnalysisAgentKindFilter(
  kind: ListAnalysesAgentKind,
): Prisma.AiAnalysisWhereInput {
  switch (kind) {
    case 'followup':
      return kindOrClause(AI_AGENT_POST_SNAPSHOT_SUMMARY_V1, 'followup');
    case 'trend':
      return kindOrClause(AI_AGENT_TREND_V1, 'trend');
    case 'credibility':
      return kindOrClause(AI_AGENT_CREDIBILITY_V1, 'credibility');
    case 'factcheck':
      return kindOrClause(AI_AGENT_FACT_CHECK_V1, 'factcheck');
    case 'trend_analysis':
      return kindOrClause(AI_AGENT_TREND_ANALYSIS_V1, 'trend_analysis');
    case 'timeseries':
      return kindOrClause(AI_AGENT_TIME_SERIES_V1, 'timeseries');
    case 'ranking':
      return kindOrClause(AI_AGENT_RANKING_V1, 'ranking');
    case 'default':
      return { NOT: { OR: EXCLUDED_FROM_DEFAULT } };
    default:
      return {};
  }
}
