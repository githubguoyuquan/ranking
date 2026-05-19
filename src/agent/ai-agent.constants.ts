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

/** 写入 `AiAnalysis.detailJson.agentKind`，便于管理台与统计区分 */
export type AiAnalysisAgentKind =
  | 'followup'
  | 'trend'
  | 'credibility'
  | 'factcheck'
  | 'default';

export function resolveAiAnalysisAgentKind(agent: string): AiAnalysisAgentKind {
  const a = agent.trim();
  if (a === AI_AGENT_POST_SNAPSHOT_SUMMARY_V1) return 'followup';
  if (a === AI_AGENT_TREND_V1) return 'trend';
  if (a === AI_AGENT_CREDIBILITY_V1) return 'credibility';
  if (a === AI_AGENT_FACT_CHECK_V1) return 'factcheck';
  return 'default';
}

/** `ai-agent` 队列允许的 agent（含快照跟进与话题生命周期） */
export const AI_AGENT_ORCHESTRATION_ALLOWLIST = new Set([
  AI_AGENT_RULES_V1,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_TREND_V1,
  AI_AGENT_CREDIBILITY_V1,
  AI_AGENT_TOPIC_DISCOVERY_V1,
  AI_AGENT_TOPIC_MERGE_V1,
  AI_AGENT_FACT_CHECK_V1,
  AI_AGENT_DUPLICATE_DETECTION_V1,
]);

const ORCHESTRATION_PIPELINE_MAX_STEPS = 12;

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

/** `ranking-followup` 流水线允许的 `agent`（逗号分隔，顺序即 DAG 执行序） */
const FOLLOWUP_PIPELINE_ALLOWLIST = new Set([
  AI_AGENT_RULES_V1,
  AI_AGENT_POST_SNAPSHOT_SUMMARY_V1,
  AI_AGENT_TREND_V1,
  AI_AGENT_CREDIBILITY_V1,
]);

const FOLLOWUP_PIPELINE_MAX_STEPS = 8;

export function parseFollowupAnalyzePipeline(raw: string): {
  agents: string[];
  unknown: string[];
} {
  const unknown: string[] = [];
  const agents: string[] = [];
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    const name = p.slice(0, 120);
    if (FOLLOWUP_PIPELINE_ALLOWLIST.has(name)) {
      if (agents.length < FOLLOWUP_PIPELINE_MAX_STEPS) {
        agents.push(name);
      }
    } else {
      unknown.push(p);
    }
  }
  return { agents, unknown };
}
