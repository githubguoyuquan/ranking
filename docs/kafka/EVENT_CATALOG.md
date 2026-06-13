# Kafka 事件网与 Schema

Outbox → Kafka 外发契约。实现：`src/kafka/`（注册表、AJV、Schema Registry REST）。

**消费边界**：本仓库 **platform 进程不运行 Kafka Consumer**；外部队列说明见 **[CONSUMER_BOUNDARY.md](./CONSUMER_BOUNDARY.md)**。MVP 下游：`consumers/snapshot-notify/`（`ranking.snapshot.completed`）。

## 封套（Envelope）v1

| 字段 | 说明 |
|------|------|
| `envelopeVersion` | 固定 `1` |
| `type` | 与 `OutboxEvent.type` 一致 |
| `payload` | 见各 JSON Schema |
| `meta.outboxId` / `meta.createdAt` | 溯源 |

Schema：`src/kafka/schemas/event-envelope-v1.schema.json`。

## Topic 全量注册

路由定义：**`src/kafka/event-registry.ts`**。运维目录：**`GET /admin/kafka/events`**（含 `publishToKafka`、`sideEffect`）。

| `OutboxEvent.type` | 默认 Topic | Kafka 外发 | 进程内侧效应 |
|--------------------|------------|------------|--------------|
| `ranking.snapshot.completed` | `ranking.snapshot.completed` | ✅ | — |
| `crawl.url.fetched` | `crawl.url.fetched` | ✅ | — |
| `ai.agent.run.completed` | `ai.agent.run.completed` | ✅ | — |
| `clickhouse.ranking.snapshot.ingest` | `clickhouse.ranking.snapshot.ingest` | ✅ 镜像 | CH Flusher |
| `elasticsearch.entity.sync` | `elasticsearch.entity.sync` | ✅ 镜像 | ES Flusher |
| `elasticsearch.crawled_url.sync` | `elasticsearch.crawled_url.sync` | ✅ 镜像 | ES Flusher |
| `ranking.followup.requested` | `ranking.followup.requested` | ❌ | BullMQ `ranking-followup` |

Topic 环境变量：`KAFKA_TOPIC_*`（见 registry 各行的 `topicEnvVar`）。

## Schema Registry

- 开发：Redpanda `http://localhost:18081`（`docker compose`）
- 生产：`KAFKA_SCHEMA_REGISTRY_URL` — Confluent/Apicurio 兼容 REST
- 发布前注册 subject（`{topic}-value`）；消息体仍为 **UTF-8 JSON 封套**（非 Avro wire）

## Outbox 双轨

| 字段 | 含义 |
|------|------|
| `kafkaPublishedAt` | 已外发到 Kafka（仅 `publishToKafka=true` 的 type） |
| `publishedAt` | 进程内 Flusher 已完成（ES/CH） |

## 新增事件 checklist

1. `outbox.constants.ts` 增加 type  
2. `event-registry.ts` 的 `ROUTED`（设置 `publishToKafka`、`sideEffect`）  
3. `src/kafka/schemas/*-payload-v1.schema.json`  
4. 业务处 `outboxEvent.create`  
5. 更新本文档与 **CONSUMER_BOUNDARY.md**  

## 校验与救急

- 默认 AJV 校验封套 + payload  
- `KAFKA_SKIP_SCHEMA_VALIDATION=true` 仅救急  
