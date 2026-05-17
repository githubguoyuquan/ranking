/** Kafka topic for successful snapshot materialization */
export const KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED =
  process.env.KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED ?? 'ranking.snapshot.completed';

/** Outbox row type (matches DB `OutboxEvent.type`) */
export const OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED = 'ranking.snapshot.completed';
