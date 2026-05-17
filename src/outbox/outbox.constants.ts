/** Kafka topic for successful snapshot materialization */
export const KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED =
  process.env.KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED ?? 'ranking.snapshot.completed';

/** Outbox row type (matches DB `OutboxEvent.type`) */
export const OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED = 'ranking.snapshot.completed';

/** 异步写入 ClickHouse（与 Kafka 行同事务插入，由 ClickhouseOutboxFlusher 消费） */
export const OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT = 'clickhouse.ranking.snapshot.ingest';
