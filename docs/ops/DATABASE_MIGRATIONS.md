# 数据库迁移（Prisma）

本仓库使用 [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate)。迁移文件在 `prisma/migrations/`，锁文件为 `migration_lock.toml`（PostgreSQL）。

## 本地开发

```bash
# 启动 Postgres（示例）
docker compose up -d postgres

# 应用已有迁移并生成 Client
npm run prisma:deploy
npm run prisma:generate

# 或：开发中新建迁移（会改 schema 时）
npm run prisma:migrate
```

`npm run prisma:deploy` 等价于 `npx prisma migrate deploy`：只应用 `prisma/migrations` 中尚未执行的 SQL，**不**交互式改 schema。

## 各环境部署清单

| 环境 | 命令 | 说明 |
|------|------|------|
| 本地 / CI | `DATABASE_URL=... npm run prisma:deploy` | 部署前确保 URL 指向目标库 |
| Staging / Prod | 同上，在发布 Job 或 Init 容器中执行 | **先于**或**与** API 滚动同步；新列需先迁移再启新代码 |
| Helm | 见下方 `migrate-job` | 一次性 Job，与 API 使用同一 `DATABASE_URL` |

### 近期重要迁移（按需核对）

| 目录 | 内容 |
|------|------|
| `20260520100000_crawl_global_scheduler` | `Source` 调度字段 + `CrawlScheduleRun` |
| `20260519200000_outbox_kafka_published_at` | Outbox `kafkaPublishedAt` |
| `20260519180000_multi_agent_orchestration` | Agent 编排表 |

完整列表：`ls prisma/migrations`

## 生产注意事项

1. **备份**：`migrate deploy` 前对 RDS 做快照或确认 PITR 可用。
2. **顺序**：先 `prisma migrate deploy`，再滚动升级 API / Worker（新代码依赖新列时）。
3. **只读副本**：迁移仅在 **writer**（`DATABASE_URL`）执行；`DATABASE_READ_URL` 自动跟随。
4. **失败回滚**：Prisma 不自动 down；需从备份恢复或手写补偿 SQL。勿在生产使用 `migrate dev`。
5. **权限**：迁移用户需 `CREATE TABLE` / `ALTER` 等 DDL 权限。

## Helm 一次性迁移 Job

```bash
helm upgrade --install ranking deploy/helm/ranking \
  -f deploy/helm/ranking/values-production.yaml \
  --set migrateJob.enabled=true \
  --set env.DATABASE_URL='postgresql://...'
```

模板：`deploy/helm/ranking/templates/migrate-job.yaml`（`migrateJob.enabled` 默认 `false`）。

## 验证

```bash
npx prisma migrate status
# 应显示：Database schema is up to date!

# 可选：查看调度表
psql "$DATABASE_URL" -c '\d "CrawlScheduleRun"'
```

## 故障排查

| 现象 | 处理 |
|------|------|
| `P3009 migrate found failed migrations` | 修复 DB 后 `prisma migrate resolve`（见 Prisma 文档） |
| API 启动报未知列 | 未 deploy；在目标库执行 `npm run prisma:deploy` |
| 多环境 schema 不一致 | 对各环境分别 `migrate status`，禁止手改仅某一环境的表结构 |
