export const OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED = 'ranking.followup.requested';

export type RankingFollowupRequestedPayload = {
  schemaVersion: 1;
  snapshotId: string;
  topicRankingId: string;
  topicVersionId: string;
  topicId: string;
  timeWindow: string;
  snapshotTime: string;
};

export type KafkaEnvelopeV1 = {
  envelopeVersion: 1;
  type: string;
  payload: RankingFollowupRequestedPayload;
  meta: {
    outboxId: string;
    createdAt: string;
  };
};

export type ConsumerConfig = {
  brokers: string[];
  topic: string;
  groupId: string;
  clientId: string;
  dispatchUrl: string;
  dispatchApiKey: string | null;
  ledgerPath: string;
  httpPort: number;
  fromBeginning: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConsumerConfig {
  const brokers = (env.KAFKA_BROKERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKERS is required');
  }
  const dispatchUrl =
    env.RANKING_FOLLOWUP_DISPATCH_URL?.trim() ||
    'http://host.docker.internal:3000/admin/ranking-followup/dispatch';
  return {
    brokers,
    topic:
      env.KAFKA_TOPIC_RANKING_FOLLOWUP_REQUESTED?.trim() ||
      'ranking.followup.requested',
    groupId: env.KAFKA_CONSUMER_GROUP?.trim() || 'ranking-followup-dispatch',
    clientId: env.KAFKA_CLIENT_ID?.trim() || 'ranking-followup-dispatch',
    dispatchUrl,
    dispatchApiKey: env.RANKING_FOLLOWUP_DISPATCH_API_KEY?.trim() || null,
    ledgerPath:
      env.FOLLOWUP_DISPATCH_LEDGER_PATH?.trim() ||
      './data/followup-processed-outbox-ids.jsonl',
    httpPort: Number(env.FOLLOWUP_DISPATCH_HTTP_PORT ?? '3011') || 3011,
    fromBeginning: env.KAFKA_CONSUMER_FROM_BEGINNING === 'true',
  };
}
