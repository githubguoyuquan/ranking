/** Kafka topic for successful snapshot materialization */
export const KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED =
  process.env.KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED ?? 'ranking.snapshot.completed';

/** Outbox row type (matches DB `OutboxEvent.type`) */
export const OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED = 'ranking.snapshot.completed';

/** 排行物化后编排占位（默认仅写 DB，不送 Kafka；Phase B 扩展 Agent / 多步任务） */
export const OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED = 'ranking.followup.requested';

/** 异步写入 ClickHouse（与 Kafka 行同事务插入，由 ClickhouseOutboxFlusher 消费） */
export const OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT = 'clickhouse.ranking.snapshot.ingest';

/** 实体变更同步 Elasticsearch（同事务插入，由 ElasticEntityOutboxFlusher 消费） */
export const OUTBOX_TYPE_ELASTIC_ENTITY_SYNC = 'elasticsearch.entity.sync';

/** CrawledUrl（真抓取成功等）同步 ES 全文索引（同事务插入，由 ElasticCrawledUrlOutboxFlusher 消费） */
export const OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC = 'elasticsearch.crawled_url.sync';

/** 爬取 URL 已落库（Kafka 事件网；与 ES sync 行可并存） */
export const OUTBOX_TYPE_CRAWL_URL_FETCHED = 'crawl.url.fetched';

/** AgentRun 完成（Kafka 事件网） */
export const OUTBOX_TYPE_AI_AGENT_RUN_COMPLETED = 'ai.agent.run.completed';
