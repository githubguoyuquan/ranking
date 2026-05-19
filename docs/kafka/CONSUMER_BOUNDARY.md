# Kafka 消费边界（本仓库 = 仅生产者 + 进程内 Flusher）

## 结论

| 角色 | 本仓库 | 外部系统 |
|------|--------|----------|
| **Kafka Producer** | ✅ `OutboxPublisherService` → `KafkaProducerService` | — |
| **Kafka Consumer** | ❌ **无** consumer group / `@MessagePattern` | ✅ 由下游服务订阅 topic |
| **索引 / OLAP 写入** | ✅ **进程内 Outbox Flusher**（`publishedAt`） | 可选：订阅 Kafka 镜像自行写入 |

本 monorepo 将 Kafka 定位为 **外部队列（integration bus）**：契约、Schema、topic 路由在 `src/kafka/`，**不在此进程内消费**。

## 双轨 Outbox

同一 `OutboxEvent` 行有两个完成标记：

| 字段 | 含义 | 谁写入 |
|------|------|--------|
| `publishedAt` | 进程内侧效应已完成（ES/CH 索引等） | `*OutboxFlusherService` |
| `kafkaPublishedAt` | 已外发到 Kafka broker | `OutboxPublisherService` |

并非所有 type 都会走两轨，见下表。

## 按 `OutboxEvent.type` 分流

| type | Kafka 外发 (`publishToKafka`) | 进程内消费 | 说明 |
|------|------------------------------|------------|------|
| `ranking.snapshot.completed` | ✅ | — | 领域事件；外部搜索/通知/数仓订阅 |
| `crawl.url.fetched` | ✅ | — | 抓取落库通知 |
| `ai.agent.run.completed` | ✅ | — | Agent 运行结束 |
| `clickhouse.ranking.snapshot.ingest` | ✅（镜像） | ✅ **CH Flusher**（权威） | 双轨；本服务 CH 写入不依赖 Kafka |
| `elasticsearch.entity.sync` | ✅（镜像） | ✅ **ES Flusher**（权威） | 双轨；与 Qdrant 双写并行 |
| `elasticsearch.crawled_url.sync` | ✅（镜像） | ✅ **ES Flusher**（权威） | 双轨 |
| `ranking.followup.requested` | ❌ | ✅ **BullMQ** `ranking-followup` | Outbox 仅占位/可观测；跟进由队列执行 |

注册表源码：`src/kafka/event-registry.ts`（`publishToKafka`、`sideEffect`）。

## 外部消费方（规划）

以下由**独立部署**的服务实现（不在本仓库）：

- **搜索索引管道**：订阅 `elasticsearch.*` 或 `ranking.snapshot.completed`（若拆服务）
- **分析 / 数仓**：订阅 `clickhouse.ranking.snapshot.ingest`、`ranking.snapshot.completed`
- **风控 / 计费 / 对账**：按 topic 独立 consumer group
- **实时通知**：订阅 `ranking.snapshot.completed`、`ai.agent.run.completed`

消费契约：Envelope v1 + JSON Schema（`docs/kafka/EVENT_CATALOG.md`）。

## 与 BullMQ 的边界

| 机制 | 用途 |
|------|------|
| **BullMQ**（Redis） | 同进程/同集群**任务编排**：`ranking`、`ranking-followup`、`crawl`、`ai-agent` |
| **Kafka** | **跨服务**、可重放、多订阅方的事件网 |

不要在本仓库内为「刷 ES/CH」再实现 Kafka Consumer——已有 Flusher；重复消费会导致双写冲突。

## 运维

- 目录：`GET /admin/kafka/events`（含 `publishToKafka`、`sideEffect`）
- Kafka 积压告警：仅统计 `publishToKafka=true` 且 `kafkaPublishedAt IS NULL`（见 `docs/ops/OBSERVABILITY.md`）
- 未配置 `KAFKA_BROKERS`：仅积累待外发行，Flusher 仍可按 `publishedAt` 工作

## 何时在本仓库新增 Kafka Consumer？

仅当明确需要**同一部署单元**内订阅他系统 topic 时（例如接入第三方 webhook 流）。默认应新建微服务或 Serverless 消费者，保持本仓库 **producer + flusher** 边界。
