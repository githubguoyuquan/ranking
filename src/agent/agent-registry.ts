import {
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_DUPLICATE_DETECTION_V1,
  AI_AGENT_FACT_CHECK_V1,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_RANKING_V1,
  AI_AGENT_RULES_V1,
  AI_AGENT_TIME_SERIES_V1,
  AI_AGENT_TOPIC_DISCOVERY_V1,
  AI_AGENT_TOPIC_MERGE_V1,
  AI_AGENT_TREND_ANALYSIS_V1,
  AI_AGENT_TREND_V1,
} from './ai-agent.constants';

export type AgentDefinition = {
  id: string;
  category: 'snapshot' | 'lifecycle' | 'ingestion';
  description: string;
  requiredInput: string[];
  produces: 'AiAnalysis' | 'TopicProposal' | 'AgentRun' | 'report';
};

export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: AI_AGENT_RULES_V1,
    category: 'snapshot',
    description: '规则摘要 + 可选 GPT 润色',
    requiredInput: ['snapshotId'],
    produces: 'AiAnalysis',
  },
  {
    id: AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
    category: 'snapshot',
    description: '物化后运营可读摘要',
    requiredInput: ['snapshotId'],
    produces: 'AiAnalysis',
  },
  {
    id: AI_AGENT_TREND_V1,
    category: 'snapshot',
    description: '名次动量与 trendType 解读',
    requiredInput: ['snapshotId'],
    produces: 'AiAnalysis',
  },
  {
    id: AI_AGENT_CREDIBILITY_V1,
    category: 'snapshot',
    description: '榜单可解释性/局限短评',
    requiredInput: ['snapshotId'],
    produces: 'AiAnalysis',
  },
  {
    id: AI_AGENT_FACT_CHECK_V1,
    category: 'snapshot',
    description: '跨信源指标冲突检测',
    requiredInput: ['snapshotId'],
    produces: 'AiAnalysis',
  },
  {
    id: AI_AGENT_TREND_ANALYSIS_V1,
    category: 'snapshot',
    description: 'TrendAnalysis 涨/跌榜与标签分布解读',
    requiredInput: ['snapshotId'],
    produces: 'AiAnalysis',
  },
  {
    id: AI_AGENT_TIME_SERIES_V1,
    category: 'snapshot',
    description: 'ClickHouse + PG 时序联合结论',
    requiredInput: ['snapshotId'],
    produces: 'AiAnalysis',
  },
  {
    id: AI_AGENT_RANKING_V1,
    category: 'snapshot',
    description: 'policy 权重与 EntityMetric 覆盖率诊断',
    requiredInput: ['snapshotId'],
    produces: 'AiAnalysis',
  },
  {
    id: AI_AGENT_TOPIC_DISCOVERY_V1,
    category: 'lifecycle',
    description: '爬取标题聚类 → TopicProposal',
    requiredInput: [],
    produces: 'TopicProposal',
  },
  {
    id: AI_AGENT_TOPIC_MERGE_V1,
    category: 'lifecycle',
    description: '同义话题合并与 Source 迁移',
    requiredInput: ['sourceTopicId', 'targetTopicId'],
    produces: 'AgentRun',
  },
  {
    id: AI_AGENT_DUPLICATE_DETECTION_V1,
    category: 'ingestion',
    description: 'URL/内容哈希重复检测报告',
    requiredInput: [],
    produces: 'report',
  },
];

export function listAgentRegistry(): AgentDefinition[] {
  return AGENT_REGISTRY;
}

export function getAgentDefinition(id: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id.trim());
}
