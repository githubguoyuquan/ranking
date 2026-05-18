# Kafka 事件网与 Schema

本目录描述 **Outbox → Kafka** 的外发契约。实现代码：`src/kafka/`（注册表、AJV 校验、JSON Schema 文件）。

## 封套（Envelope）v1

每条 Kafka 消息值为 UTF-8 JSON，**根对象**字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `envelopeVersion` | `1` | 外层层级版本；与业务 `payload.schemaVersion` 独立 |
| `type` | string | 与 `OutboxEvent.type` 一致，如 `ranking.snapshot.completed` |
| `payload` | object | 事件体，见下文各 `$id` |
| `meta` | object | `outboxId`（十进制字符串）、`createdAt`（ISO-8601） |

JSON Schema：`src/kafka/schemas/event-envelope-v1.schema.json`。

## Topic 注册

| `OutboxEvent.type` | Topic 默认 | 环境变量覆盖 |
|--------------------|------------|--------------|
| `ranking.snapshot.completed` | `ranking.snapshot.completed` | `KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED` |

路由定义集中保存在 **`src/kafka/event-registry.ts`**。新增送 Kafka 的事件时：

1. 在 `event-registry.ts` 的 `ROUTED` 数组追加一项；
2. 在 `src/kafka/schemas/` 增加 payload 的 JSON Schema；
3. 在 `src/kafka/schemas/` 增加 payload 的 JSON Schema（文件名与注册表一致即可，`KafkaEventSchemaService` 启动时按 `listKafkaRoutedEvents()` 自动加载）。

## Payload：`ranking.snapshot.completed` v1

| 字段 | 说明 |
|------|------|
| `schemaVersion` | 固定 `1` |
| `snapshotId` 等 | 十进制 ID 字符串 |
| `timeWindow` | `REALTIME` \| `DAY` \| `WEEK` \| `MONTH` \| `YEAR` \| `CUSTOM` |
| `hasScoreModel` / `scoreModelId` | 与物化结果一致 |

JSON Schema：`src/kafka/schemas/ranking-snapshot-completed-payload-v1.schema.json`。  
TypeScript 构建器：`src/rankings/ranking-snapshot-completed-outbox-payload.ts`。

## 发布前校验

- 默认 **开启** JSON Schema 校验（封套 + payload）。
- 救急可设 **`KAFKA_SKIP_SCHEMA_VALIDATION=true`**（打日志警告，**禁止长期用于生产**）。

## 消费方建议

1. 解析 JSON 后检查 **`envelopeVersion`**，按版本分派解码逻辑。  
2. 使用 **`type`** 与 **`payload.schemaVersion`** 做双维版本路由。  
3. **Partition key**：当前实现以 `payload.snapshotId`（若存在）作为 Kafka message key，便于单快照有序。

## 运维

- `GET /health/kafka`：broker 探活 + 已加载的 schema 路由摘要 + 是否跳过校验。
