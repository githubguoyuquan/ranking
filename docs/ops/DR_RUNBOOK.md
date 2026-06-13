# DR 演练与 Failover Runbook

本 runbook 配合 **`GET /admin/ops/dr/readiness`**、**`GET /admin/ops/k8s/probes`** 与 Helm 生产模板使用。

## 演练前检查

1. 调用 DR readiness API（或 `scripts/dr-readiness.sh`）确认无 `critical` 项。
2. 确认 **Postgres** Multi-AZ / PITR 可用；`DATABASE_READ_URL` 读副本可连通（可选但推荐）。
3. 确认 **Redis**、**Kafka** 跨 AZ；Schema Registry 可达。
4. 查看 Outbox：`GET /admin/ops/dr/outbox-replay-plan`，记录 pending Kafka 数量与最老积压年龄。
5. 爬虫：`CrawlCheckpoint` 数量 > 0；调度 SLA 未 stale（`GET /admin/crawl/overview`）。

## K8s 探针约定

| 探针 | 路径 | 说明 |
|------|------|------|
| liveness | `GET /health` | 进程存活 |
| readiness | `GET /health/ready` | PG + Redis |
| startup | `GET /health/ready` | 冷启动，失败阈值放宽 |

聚合视图：`GET /admin/ops/k8s/probes`。

Helm：`deploy/helm/ranking/templates/api-deployment.yaml` 已配置 live/ready/startup；生产见 `values-production.yaml`（HPA、Ingress、ServiceMonitor 可选）。

## 组件 Failover

### API

- 多副本 + PDB + topology spread（3 AZ）。
- 读流量可经 `DATABASE_READ_URL` 走只读副本（Scale 模块只读 Prisma）。
- Ingress 指向 `*-api` Service。

### Platform Worker

- 至少 2 副本；Outbox Kafka 发布与 Flusher 仅 worker 角色执行。
- Failover 后检查 Outbox lag 告警恢复。

### Crawl Worker

- 水平扩展；区域分片 `crawlWorkerRegions` + `CRAWL_QUEUE_SHARD`。
- checkpoint 表保证增量续跑。

## Outbox Kafka 重放

1. `GET /admin/ops/dr/outbox-replay-plan` 查看按 type 的 pending 统计。
2. 将目标行 `kafkaPublishedAt` 置空（示例见 [PRODUCTION.md](./PRODUCTION.md)）。
3. 确保 Platform Worker 运行；监控 `ranking_outbox_*` Prometheus 指标。

## 备份恢复验证（季度）

| 资产 | 动作 |
|------|------|
| Postgres | PITR 恢复到隔离实例；跑 `npm run prisma:deploy` 校验 |
| Redis | 复制组 failover 演练（BullMQ 队列可重建则记录 RPO） |
| Kafka | 保留期 ≥ 业务重放窗口；Consumer 边界见 `docs/kafka/CONSUMER_BOUNDARY.md` |
| ES / Qdrant / CH | 按厂商快照恢复至 staging |
| 爬虫 | 从 checkpoint + 任务状态续跑 |

## 环境变量（DR 元数据）

| 变量 | 用途 |
|------|------|
| `DR_REGION` | readiness 响应中的 region |
| `DR_CLUSTER` | 集群标识 |
| `K8S_NAMESPACE` | 可由 Downward API 注入 |
| `DATABASE_READ_URL` | 读副本 |

## 相关文档

- [PRODUCTION.md](./PRODUCTION.md) — 拓扑与 Helm
- [OBSERVABILITY.md](./OBSERVABILITY.md) — Prometheus / 告警
- [ALERT_ONCALL_RUNBOOK.md](./ALERT_ONCALL_RUNBOOK.md) — 统一 Webhook 与值班 triage
- [DATABASE_MIGRATIONS.md](./DATABASE_MIGRATIONS.md) — 迁移 Job
