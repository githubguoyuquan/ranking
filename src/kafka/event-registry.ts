import {
  OUTBOX_TYPE_AI_AGENT_RUN_COMPLETED,
  OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
  OUTBOX_TYPE_CRAWL_URL_FETCHED,
  OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC,
  OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
  OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED,
  OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
} from '../outbox/outbox.constants';

/** 当前唯一的 Kafka 外发封套版本（与 JSON Schema `event-envelope-v1` 对齐） */
export const KAFKA_ENVELOPE_VERSION = 1 as const;

export type KafkaRoutedEventDefinition = {
  /** 与 OutboxEvent.type 一致 */
  outboxType: string;
  /** 环境变量名，决定目标 topic */
  topicEnvVar: string;
  /** env 未设置或为空时的 topic */
  defaultTopic: string;
  /** `src/kafka/schemas/` 下 payload 校验用文件名 */
  payloadSchemaFile: string;
  /** Schema Registry subject（Confluent 惯例 `{topic}-value`） */
  schemaRegistrySubject: string;
  /** 事件说明（给运维 / 消费方目录用） */
  description: string;
};

const ROUTED: KafkaRoutedEventDefinition[] = [
  {
    outboxType: OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
    topicEnvVar: 'KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED',
    defaultTopic: 'ranking.snapshot.completed',
    payloadSchemaFile: 'ranking-snapshot-completed-payload-v1.schema.json',
    schemaRegistrySubject: 'ranking.snapshot.completed-value',
    description:
      'TopicRankSnapshot 物化成功；下游可据此刷新搜索、通知、指标等。',
  },
  {
    outboxType: OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED,
    topicEnvVar: 'KAFKA_TOPIC_RANKING_FOLLOWUP_REQUESTED',
    defaultTopic: 'ranking.followup.requested',
    payloadSchemaFile: 'ranking-followup-requested-payload-v1.schema.json',
    schemaRegistrySubject: 'ranking.followup.requested-value',
    description: '排行物化后跟进链（AI Agent / 多步分析）已请求。',
  },
  {
    outboxType: OUTBOX_TYPE_CRAWL_URL_FETCHED,
    topicEnvVar: 'KAFKA_TOPIC_CRAWL_URL_FETCHED',
    defaultTopic: 'crawl.url.fetched',
    payloadSchemaFile: 'crawl-url-fetched-payload-v1.schema.json',
    schemaRegistrySubject: 'crawl.url.fetched-value',
    description: 'CrawledUrl 已写入 PG；可与 ES 索引消费者并行订阅。',
  },
  {
    outboxType: OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
    topicEnvVar: 'KAFKA_TOPIC_CLICKHOUSE_RANKING_SNAPSHOT',
    defaultTopic: 'clickhouse.ranking.snapshot.ingest',
    payloadSchemaFile: 'clickhouse-ranking-snapshot-ingest-payload-v1.schema.json',
    schemaRegistrySubject: 'clickhouse.ranking.snapshot.ingest-value',
    description:
      '快照指标写入 ClickHouse（与进程内 Flusher 双轨；Kafka 供分析管道订阅）。',
  },
  {
    outboxType: OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
    topicEnvVar: 'KAFKA_TOPIC_ELASTIC_ENTITY_SYNC',
    defaultTopic: 'elasticsearch.entity.sync',
    payloadSchemaFile: 'elasticsearch-entity-sync-payload-v1.schema.json',
    schemaRegistrySubject: 'elasticsearch.entity.sync-value',
    description: '实体索引 upsert/delete（与 ES Flusher 双轨）。',
  },
  {
    outboxType: OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC,
    topicEnvVar: 'KAFKA_TOPIC_ELASTIC_CRAWLED_URL_SYNC',
    defaultTopic: 'elasticsearch.crawled_url.sync',
    payloadSchemaFile: 'elasticsearch-crawled-url-sync-payload-v1.schema.json',
    schemaRegistrySubject: 'elasticsearch.crawled_url.sync-value',
    description: '爬取 URL 全文索引 upsert/delete（与 ES Flusher 双轨）。',
  },
  {
    outboxType: OUTBOX_TYPE_AI_AGENT_RUN_COMPLETED,
    topicEnvVar: 'KAFKA_TOPIC_AI_AGENT_RUN_COMPLETED',
    defaultTopic: 'ai.agent.run.completed',
    payloadSchemaFile: 'ai-agent-run-completed-payload-v1.schema.json',
    schemaRegistrySubject: 'ai.agent.run.completed-value',
    description: '多 Agent 编排单次运行结束（completed / failed）。',
  },
];

const byType = new Map(ROUTED.map((d) => [d.outboxType, d]));

export function listKafkaRoutedEvents(): readonly KafkaRoutedEventDefinition[] {
  return ROUTED;
}

export function listKafkaRoutedOutboxTypes(): string[] {
  return ROUTED.map((r) => r.outboxType);
}

export function getKafkaRouteForOutboxType(
  type: string,
): KafkaRoutedEventDefinition | undefined {
  return byType.get(type);
}

export function resolveKafkaTopicForOutboxType(type: string): string | null {
  const d = byType.get(type);
  if (!d) return null;
  const raw = process.env[d.topicEnvVar]?.trim();
  return raw && raw.length > 0 ? raw : d.defaultTopic;
}

export function buildKafkaEnvelopeV1(args: {
  type: string;
  payload: unknown;
  outboxId: bigint;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    envelopeVersion: KAFKA_ENVELOPE_VERSION,
    type: args.type,
    payload: args.payload,
    meta: {
      outboxId: args.outboxId.toString(),
      createdAt: args.createdAt.toISOString(),
    },
  };
}

/** Kafka message key，便于分区内有序 */
export function resolveKafkaMessageKey(
  type: string,
  payload: unknown,
  outboxId: bigint,
): string {
  const p =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  if (type === OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED && p?.snapshotId) {
    return String(p.snapshotId);
  }
  if (type === OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED && p?.snapshotId) {
    return String(p.snapshotId);
  }
  if (type === OUTBOX_TYPE_CRAWL_URL_FETCHED && p?.crawledUrlId) {
    return String(p.crawledUrlId);
  }
  if (type === OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT && p?.snapshotId) {
    return String(p.snapshotId);
  }
  if (type === OUTBOX_TYPE_ELASTIC_ENTITY_SYNC && p?.entityId) {
    return String(p.entityId);
  }
  if (type === OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC && p?.crawledUrlId) {
    return String(p.crawledUrlId);
  }
  if (type === OUTBOX_TYPE_AI_AGENT_RUN_COMPLETED && p?.agentRunId) {
    return String(p.agentRunId);
  }
  return outboxId.toString();
}
