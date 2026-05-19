# 生产运维与多 AZ

## 拓扑（推荐）

- **3 AZ** EKS/GKE 节点池；`topologySpreadConstraints` 见 `deploy/helm/ranking/values-production.yaml`
- **RDS Postgres** Multi-AZ；应用 `DATABASE_URL` 指向 writer
- **ElastiCache Redis** 集群模式或复制组（BullMQ + 缓存）
- **MSK / Confluent / 自建 Redpanda** 三副本跨 AZ；`KAFKA_BROKERS`
- **Schema Registry** 托管或 Redpanda SR；`KAFKA_SCHEMA_REGISTRY_URL`（如 `https://sr.example.com`）

## 数据库迁移

发布前在目标库执行 **`npm run prisma:deploy`**（或 Helm `migrateJob.enabled=true`）。详见 [DATABASE_MIGRATIONS.md](./DATABASE_MIGRATIONS.md)。

## Helm 部署

```bash
docker build -t ranking-platform:0.1.0 .
helm upgrade --install ranking deploy/helm/ranking \
  -f deploy/helm/ranking/values-production.yaml \
  --set migrateJob.enabled=true \
  --set env.DATABASE_URL='...' \
  --set env.REDIS_URL='...' \
  --set env.KAFKA_BROKERS='broker1:9092,broker2:9092'
```

组件：

| Deployment | 副本（参考） | 说明 |
|------------|-------------|------|
| `*-api` | 3 | `PROCESS_ROLE=api`，`/health/ready` |
| `*-platform-worker` | 2 | Outbox Kafka + 排行 Worker |
| `*-crawl-worker` | 2+ | 抓取水平扩展 |

## Outbox 双轨

- **`kafkaPublishedAt`**：Kafka 外发完成
- **`publishedAt`**：进程内 Flusher（ES/CH）完成  

重放 Kafka：将目标类型行的 `kafkaPublishedAt` 置空并确保 `leasedUntil` 过期，由 Platform Worker 重新发布。

```sql
UPDATE "OutboxEvent"
SET "kafkaPublishedAt" = NULL, "leasedUntil" = NULL, "lastError" = NULL
WHERE type = 'ranking.snapshot.completed' AND id BETWEEN 1 AND 1000;
```

管理台：`GET /admin/outbox?pendingOnly=true`；Kafka 目录：`GET /admin/kafka/events`（含 `publishToKafka`）。**本服务不消费 Kafka** — 见 `docs/kafka/CONSUMER_BOUNDARY.md`。

## 探活

| 路径 | 用途 |
|------|------|
| `GET /health/ready` | K8s readiness（PG+Redis） |
| `GET /health/kafka` | Broker + Schema Registry |
| `GET /admin/kafka/status` | 运维聚合 |

## 备份与 DR（摘要）

- Postgres PITR；定期验证恢复
- ClickHouse / ES 按厂商快照
- 爬虫：`CrawlCheckpoint` + 任务状态可续跑
- 事件网：Kafka 保留期 ≥ 业务重放窗口

## 环境变量清单

见仓库根目录 `.env.example`（`PROCESS_ROLE`、`KAFKA_*`、`KAFKA_SCHEMA_REGISTRY_URL`）。
