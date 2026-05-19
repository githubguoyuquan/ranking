/** BullMQ 多 Agent 编排队列 */
export const AI_AGENT_QUEUE = 'ai-agent';

export const AI_AGENT_JOB_NAME = 'run-agent';

export const AI_AGENT_PIPELINE_JOB_NAME = 'run-pipeline';

export type AiAgentJobPayload = {
  correlationId: string;
  agent: string;
  input: Record<string, unknown>;
  parentRunId?: string;
  /** 预创建的 AgentRun.id（入队时写入） */
  agentRunId: string;
};

export type AiAgentPipelineJobPayload = {
  correlationId: string;
  agents: string[];
  input: Record<string, unknown>;
};

export function buildAiAgentJobId(agentRunId: string): string {
  return `ai-agent-${agentRunId}`;
}

export function buildAiAgentPipelineJobId(correlationId: string): string {
  return `ai-pipeline-${correlationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}`;
}
