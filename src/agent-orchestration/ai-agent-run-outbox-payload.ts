/** `OUTBOX_TYPE_AI_AGENT_RUN_COMPLETED` — Kafka 事件网 */
export type AiAgentRunCompletedOutboxPayload = {
  schemaVersion: 1;
  agentRunId: string;
  correlationId: string;
  agent: string;
  status: string;
  snapshotId: string | null;
  topicId: string | null;
  finishedAt: string;
};

export function buildAiAgentRunCompletedOutboxPayload(args: {
  agentRunId: bigint;
  correlationId: string;
  agent: string;
  status: string;
  snapshotId?: bigint | null;
  topicId?: bigint | null;
  finishedAt: Date;
}): AiAgentRunCompletedOutboxPayload {
  return {
    schemaVersion: 1,
    agentRunId: args.agentRunId.toString(),
    correlationId: args.correlationId,
    agent: args.agent,
    status: args.status,
    snapshotId: args.snapshotId?.toString() ?? null,
    topicId: args.topicId?.toString() ?? null,
    finishedAt: args.finishedAt.toISOString(),
  };
}
