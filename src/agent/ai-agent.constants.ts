/**
 * `AiAnalysis.agent` 约定名（自由文本字段；此处常量便于检索、Outbox 与 Worker 对齐）。
 * 管理台仍可向 `POST /admin/snapshots/:id/analyze` 传入自定义 `agent`（≤120）。
 */

/** 默认：规则摘要 + 可选 GPT 润色（历史行为） */
export const AI_AGENT_RULES_V1 = 'rules-v1';

/** 物化成功后由 `ranking-followup` Worker 触发，与手动分析区分 */
export const AI_AGENT_POST_SNAPSHOT_SUMMARY_V1 = 'post-snapshot-summary-v1';

/** 物化跟进链：名次动量 / 趋势标签解读（可与 summary 并行或其后启用） */
export const AI_AGENT_TREND_V1 = 'trend-v1';

/** 物化跟进链：从结构化名次与 trendType 出发的「可解释性/局限」短评（非事实核查） */
export const AI_AGENT_CREDIBILITY_V1 = 'credibility-v1';

/** 从爬取/检索内容聚类发现可排话题候选（写 `TopicProposal`） */
export const AI_AGENT_TOPIC_DISCOVERY_V1 = 'topic-discovery-v1';

/** 同义话题合并（写 `TopicMergeAudit`，迁移 `Source.topicId`） */
export const AI_AGENT_TOPIC_MERGE_V1 = 'topic-merge-v1';

/** 快照实体指标跨信源冲突检测（写 `AiAnalysis`；与 credibility 不同） */
export const AI_AGENT_FACT_CHECK_V1 = 'fact-check-v1';

/** URL/内容/语义重复检测报告（只读聚合，可选写 `AgentRun`） */
export const AI_AGENT_DUPLICATE_DETECTION_V1 = 'duplicate-detection-v1';

/** 读取 `TrendAnalysis.payload` 解读涨/跌榜与标签分布（算法 + 可选 LLM） */
export const AI_AGENT_TREND_ANALYSIS_V1 = 'trend-analysis-v1';

/** ClickHouse metric_timeseries + PG 快照元数据联合结论 */
export const AI_AGENT_TIME_SERIES_V1 = 'time-series-v1';

/** policy 权重 vs EntityMetric 覆盖率诊断 */
export const AI_AGENT_RANKING_V1 = 'ranking-agent-v1';

/** 实体多话题时间线深度解读（运营 / C 端） */
export const AI_AGENT_ENTITY_TIMELINE_REPORT_V1 = 'entity-timeline-report-v1';

/** TopicVersion 策略 diff 解读报告 */
export const AI_AGENT_TOPIC_VERSION_DIFF_REPORT_V1 = 'topic-version-diff-report-v1';

/** 写入 `AiAnalysis.detailJson.agentKind`，便于管理台与统计区分 */
export type AiAnalysisAgentKind =
  | 'followup'
  | 'trend'
  | 'credibility'
  | 'factcheck'
  | 'trend_analysis'
  | 'timeseries'
  | 'ranking'
  | 'default';

export function resolveAiAnalysisAgentKind(agent: string): AiAnalysisAgentKind {
  const a = agent.trim();
  if (a === AI_AGENT_POST_SNAPSHOT_SUMMARY_V1) return 'followup';
  if (a === AI_AGENT_TREND_V1) return 'trend';
  if (a === AI_AGENT_CREDIBILITY_V1) return 'credibility';
  if (a === AI_AGENT_FACT_CHECK_V1) return 'factcheck';
  if (a === AI_AGENT_TREND_ANALYSIS_V1) return 'trend_analysis';
  if (a === AI_AGENT_TIME_SERIES_V1) return 'timeseries';
  if (a === AI_AGENT_RANKING_V1) return 'ranking';
  return 'default';
}

/** 快照物化后跟进流水线允许的 agent */
export const SNAPSHOT_POST_PROCESS_ALLOWLIST = new Set([
  AI_AGENT_RULES_V1,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_TREND_V1,
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_FACT_CHECK_V1,
  AI_AGENT_TREND_ANALYSIS_V1,
  AI_AGENT_TIME_SERIES_V1,
  AI_AGENT_RANKING_V1,
]);

/** `ai-agent` 队列允许的 agent（含快照跟进与话题生命周期） */
export const AI_AGENT_ORCHESTRATION_ALLOWLIST = new Set([
  ...SNAPSHOT_POST_PROCESS_ALLOWLIST,
  AI_AGENT_TOPIC_DISCOVERY_V1,
  AI_AGENT_TOPIC_MERGE_V1,
  AI_AGENT_DUPLICATE_DETECTION_V1,
]);

const ORCHESTRATION_PIPELINE_MAX_STEPS = 12;
const SNAPSHOT_POST_PROCESS_MAX_STEPS = 12;

export function parseOrchestrationPipeline(raw: string): {
  agents: string[];
  unknown: string[];
} {
  const unknown: string[] = [];
  const agents: string[] = [];
  for (const p of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const name = p.slice(0, 120);
    if (AI_AGENT_ORCHESTRATION_ALLOWLIST.has(name)) {
      if (agents.length < ORCHESTRATION_PIPELINE_MAX_STEPS) agents.push(name);
    } else {
      unknown.push(p);
    }
  }
  return { agents, unknown };
}

export function parseSnapshotPostProcessPipeline(raw: string): {
  agents: string[];
  unknown: string[];
} {
  const unknown: string[] = [];
  const agents: string[] = [];
  for (const p of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const name = p.slice(0, 120);
    if (SNAPSHOT_POST_PROCESS_ALLOWLIST.has(name)) {
      if (agents.length < SNAPSHOT_POST_PROCESS_MAX_STEPS) agents.push(name);
    } else {
      unknown.push(p);
    }
  }
  return { agents, unknown };
}

/** @deprecated 使用 `parseSnapshotPostProcessPipeline`；保留旧名兼容测试 */
export function parseFollowupAnalyzePipeline(raw: string): {
  agents: string[];
  unknown: string[];
} {
  return parseSnapshotPostProcessPipeline(raw);
}

/** 快照跟进链中用于 `generatedByAi` 判定的 agent */
export const SNAPSHOT_BRIEF_AGENTS = new Set([
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_TREND_V1,
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_FACT_CHECK_V1,
  AI_AGENT_TREND_ANALYSIS_V1,
  AI_AGENT_TIME_SERIES_V1,
  AI_AGENT_RANKING_V1,
]);

/** `GET /v1/snapshots/:id/analyses?agentKind=` 合法取值 */
export const LIST_ANALYSES_AGENT_KINDS = [
  'followup',
  'trend',
  'credibility',
  'factcheck',
  'trend_analysis',
  'timeseries',
  'ranking',
  'default',
] as const;

export type ListAnalysesAgentKind = (typeof LIST_ANALYSES_AGENT_KINDS)[number];

export type AiAnalysisBriefField =
  | 'hasFollowupBrief'
  | 'hasTrendBrief'
  | 'hasCredibilityBrief'
  | 'hasFactCheckBrief'
  | 'hasTrendAnalysisBrief'
  | 'hasTimeSeriesBrief'
  | 'hasRankingBrief';

/** 快照 API `includeAiStats` 与各 `has*Brief` 字段定义 */
export const AI_ANALYSIS_BRIEF_SPECS: ReadonlyArray<{
  field: AiAnalysisBriefField;
  agent: string;
  agentKind: AiAnalysisAgentKind;
}> = [
  {
    field: 'hasFollowupBrief',
    agent: AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
    agentKind: 'followup',
  },
  { field: 'hasTrendBrief', agent: AI_AGENT_TREND_V1, agentKind: 'trend' },
  {
    field: 'hasCredibilityBrief',
    agent: AI_AGENT_CREDIBILITY_V1,
    agentKind: 'credibility',
  },
  {
    field: 'hasFactCheckBrief',
    agent: AI_AGENT_FACT_CHECK_V1,
    agentKind: 'factcheck',
  },
  {
    field: 'hasTrendAnalysisBrief',
    agent: AI_AGENT_TREND_ANALYSIS_V1,
    agentKind: 'trend_analysis',
  },
  {
    field: 'hasTimeSeriesBrief',
    agent: AI_AGENT_TIME_SERIES_V1,
    agentKind: 'timeseries',
  },
  {
    field: 'hasRankingBrief',
    agent: AI_AGENT_RANKING_V1,
    agentKind: 'ranking',
  },
];

/** 写入 `AiAnalysis` 且应计入日配额的 agent */
export const AI_ANALYSIS_PERSIST_AGENTS = new Set([
  AI_AGENT_RULES_V1,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_TREND_V1,
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_FACT_CHECK_V1,
  AI_AGENT_TREND_ANALYSIS_V1,
  AI_AGENT_TIME_SERIES_V1,
  AI_AGENT_RANKING_V1,
]);
