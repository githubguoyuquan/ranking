export const OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED = 'ranking.snapshot.completed';

export type SnapshotCompletedPayload = {
  schemaVersion: 1;
  snapshotId: string;
  topicRankingId: string;
  topicVersionId: string;
  topicId: string;
  topicVersionLabel: string;
  timeWindow: string;
  snapshotTime: string;
  snapshotVersion: string;
  itemCount: number;
  confidenceScore: number;
  hasScoreModel: boolean;
  scoreModelId: string | null;
};

export type KafkaEnvelopeV1 = {
  envelopeVersion: 1;
  type: string;
  payload: SnapshotCompletedPayload;
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
  webhookUrl: string | null;
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
  return {
    brokers,
    topic:
      env.KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED?.trim() ||
      'ranking.snapshot.completed',
    groupId: env.KAFKA_CONSUMER_GROUP?.trim() || 'ranking-snapshot-notify',
    clientId: env.KAFKA_CLIENT_ID?.trim() || 'ranking-snapshot-notify',
    webhookUrl: env.SNAPSHOT_NOTIFY_WEBHOOK_URL?.trim() || null,
    ledgerPath:
      env.SNAPSHOT_NOTIFY_LEDGER_PATH?.trim() ||
      './data/processed-outbox-ids.jsonl',
    httpPort: Number(env.SNAPSHOT_NOTIFY_HTTP_PORT ?? '3010') || 3010,
    fromBeginning: env.KAFKA_CONSUMER_FROM_BEGINNING === 'true',
  };
}
