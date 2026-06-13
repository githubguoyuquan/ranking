# AWS 生产接线（RDS / ElastiCache / MSK）

将 Ranking 平台接到 AWS 托管数据层，并通过 `PRODUCTION_WIRING_REQUIRED=true` + `GET /admin/ops/dr/readiness` 验证。

## 1. RDS PostgreSQL Multi-AZ

| 项 | 说明 |
|----|------|
| 实例 | PostgreSQL 16+，Multi-AZ 开启 |
| Writer | `DATABASE_URL` → cluster **writer** endpoint |
| Reader | `DATABASE_READ_URL` → **reader** endpoint（或 Aurora `-ro-`） |
| TLS | 连接串加 `?sslmode=require` |
| 迁移 | 仅在 writer 执行 `npm run prisma:deploy` |

示例 Secrets Manager `prod/ranking/rds` JSON：

```json
{
  "writer_url": "postgresql://app:***@ranking.cluster-abc.ap-southeast-1.rds.amazonaws.com:5432/ranking?sslmode=require",
  "reader_url": "postgresql://app:***@ranking.cluster-ro-abc.ap-southeast-1.rds.amazonaws.com:5432/ranking?sslmode=require"
}
```

读路径（`rank-history`、`trends/hot`）经 `PrismaReadService` 走 reader。

## 2. ElastiCache Redis

| 项 | 说明 |
|----|------|
| 拓扑 | 复制组，3 AZ，开启 **in-transit encryption** |
| URL | `rediss://:AUTH_TOKEN@master.xxxxx.apse1.cache.amazonaws.com:6379` |
| 用途 | BullMQ、快照缓存、SSE Pub/Sub |

应用通过 `redisConnectionFromEnv()` 对 `rediss://` 自动启用 TLS。

Secrets Manager `prod/ranking/elasticache`：

```json
{
  "url": "rediss://:token@ranking.ng.0001.apse1.cache.amazonaws.com:6379"
}
```

## 3. Amazon MSK

| 项 | 说明 |
|----|------|
| 集群 | 3 broker，跨 AZ |
| 客户端 | `KAFKA_BROKERS` = bootstrap brokers（TLS/IAM 端口通常 **9098**） |
| Schema | `KAFKA_SCHEMA_REGISTRY_URL`（Glue SR REST 或 Confluent） |
| Outbox | Platform Worker 发布；保留期 ≥ Outbox 重放窗口 |

Secrets Manager `prod/ranking/msk`：

```json
{
  "bootstrap_brokers": "b-1.xxx.kafka.ap-southeast-1.amazonaws.com:9098,b-2.xxx...",
  "schema_registry_url": "https://..."
}
```

## 4. Helm 部署

```bash
helm upgrade --install ranking deploy/helm/ranking \
  -f deploy/helm/ranking/values-production.yaml \
  -f deploy/helm/ranking/values-aws-production.yaml \
  --set externalSecrets.enabled=true \
  --set drReadinessCron.enabled=true
```

前提：

- 集群已安装 [External Secrets Operator](https://external-secrets.io/)
- `ClusterSecretStore` 名称 `aws-secrets-manager` 可访问上述 Secrets
- K8s Secret `ranking-env` 由 `templates/externalsecret.yaml` 同步

## 5. 验证

```bash
export RANKING_API_BASE=https://api.ranking.example.com
export RANKING_API_KEY=rk_admin_...
bash scripts/dr-readiness.sh
```

生产接线检查项（`prod_rds_*`、`prod_elasticache`、`prod_msk`）在 `PRODUCTION_WIRING_REQUIRED=true` 时为 **critical/warn**。

## 6. CI

- PR：`/.github/workflows/ci.yml` 跑单元测试 + `scripts/ci-dr-readiness.sh`（compose 栈）
- 定时/手动：`dr-readiness-scheduled.yml` 对 staging/prod URL 探测（Repository secrets）

## 相关

- [PRODUCTION.md](./PRODUCTION.md)
- [DR_RUNBOOK.md](./DR_RUNBOOK.md)
- [DATABASE_MIGRATIONS.md](./DATABASE_MIGRATIONS.md)
