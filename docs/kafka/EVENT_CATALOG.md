# Kafka 事件网与 Schema

Outbox → Kafka 外发契约。实现：`src/kafka/`（注册表、AJV、Schema Registry REST）。

## 封套（Envelope）v1

| 字段 | 说明 |
|------|------|
| `envelopeVersion` | 固定 `1` |
| `type` | 与 `OutboxEvent.type` 一致 |
| `payload` | 见各 JSON Schema |
| `meta.outboxId` / `meta.createdAt` | 溯源 |

Schema：`src/kafka/schemas/event-envelope-v1.schema.json`。

## Topic 全量注册

路由定义：**`src/kafka/event-registry.ts`**。运维目录：**`GET /admin/kafka/events`**。

| `OutboxEvent.type` | 默认 Topic | 环境变量 |
|--------------------|------------|----------|
| `ranking.snapshot.completed` | `ranking.snapshot.completed` | `KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED` |
| `ranking.followup.requested` | `ranking.followup.requested` | `KAFKA_TOPIC_RANKING_FOLLOWUP_REQUESTED` |
| `crawl.url.fetched` | `crawl.url.fetched` | `KAFKA_TOPIC_CRAWL_URL_FETCHED` |
| `clickhouse.ranking.snapshot.ingest` | `clickhouse.ranking.snapshot.ingest` | `KAFKA_TOPIC_CLICKHOUSE_RANKING_SNAPSHOT` |
| `elasticsearch.entity.sync` | `elasticsearch.entity.sync` | `KAFKA_TOPIC_ELASTIC_ENTITY_SYNC` |
| `elasticsearch.crawled_url.sync` | `elasticsearch.crawled_url.sync` | `KAFKA_TOPIC_ELASTIC_CRAWLED_URL_SYNC` |
| `ai.agent.run.completed` | `ai.agent.run.completed` | `KAFKA_TOPIC_AI_AGENT_RUN_COMPLETED` |

## Schema Registry

- 开发：Redpanda `http://localhost:18081`（`docker compose`）
- 生产：`KAFKA_SCHEMA_REGISTRY_URL` — Confluent/Apicurio 兼容 REST
- 发布前注册 subject（`{topic}-value`）；消息体仍为 **UTF-8 JSON 封套**（非 Avro wire）

## Outbox 与 Flusher

同一 Outbox 行可：

1. 由 **Platform Worker** 写入 Kafka（`kafkaPublishedAt`）
2. 由 **ES/CH Flusher** 写索引（`publishedAt`）

## 新增事件 checklist

1. `outbox.constants.ts` 增加 type  
2. `event-registry.ts` 的 `ROUTED`  
3. `src/kafka/schemas/*-payload-v1.schema.json`  
4. 业务处 `outboxEvent.create`  
5. 更新本文档  

## 校验与救急

- 默认 AJV 校验封套 + payload  
- `KAFKA_SKIP_SCHEMA_VALIDATION=true` 仅救急  
