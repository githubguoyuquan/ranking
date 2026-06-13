# Snapshot Notify Consumer

独立下游服务，订阅 Kafka **`ranking.snapshot.completed`**（Envelope v1 + JSON Schema）。

与主平台边界见 [docs/kafka/CONSUMER_BOUNDARY.md](../../docs/kafka/CONSUMER_BOUNDARY.md) — **本包不在 ranking-platform 进程内消费 Kafka**。

## 职责（MVP）

- Consumer group：`ranking-snapshot-notify`（可配置）
- AJV 校验封套与 payload（与 `src/kafka/schemas/` 同源副本）
- 按 `meta.outboxId` 幂等（JSONL 账本）
- 结构化日志；可选 `SNAPSHOT_NOTIFY_WEBHOOK_URL` POST
- `GET /health`、`GET /metrics`（3010）

## 本地运行

```bash
# 1. 启动 Redpanda + 主平台 API/Worker（根目录）
docker compose up -d postgres redis redpanda
npm run start:dev   # 另开 terminal: npm run start:platform-worker

# 2. 消费者
cd consumers/snapshot-notify
cp .env.example .env
npm install
npm run start:dev
```

触发事件：管理台 `/console/seed` + `/console/rankings/run`，或已有 Outbox 重放。

## 环境变量

| 变量 | 说明 |
|------|------|
| `KAFKA_BROKERS` | 必填 |
| `KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED` | 默认 `ranking.snapshot.completed` |
| `KAFKA_CONSUMER_GROUP` | 默认 `ranking-snapshot-notify` |
| `SNAPSHOT_NOTIFY_WEBHOOK_URL` | 可选通知 URL |
| `SNAPSHOT_NOTIFY_LEDGER_PATH` | 幂等账本路径 |

## Docker

```bash
docker build -t ranking-snapshot-notify:0.1.0 consumers/snapshot-notify
docker run --env-file consumers/snapshot-notify/.env ranking-snapshot-notify:0.1.0
```

Helm：`deploy/helm/ranking` 下 `snapshotNotify.enabled=true`。
