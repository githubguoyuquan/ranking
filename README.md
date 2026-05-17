# Ranking platform

## Priority & phased delivery

1. **P0 — Facts & evolution**  
   PostgreSQL + Prisma，不可变 `TopicRankSnapshot`，`RankingItem` 含 `previousRank` / `rankChange`，`RankingItemHistory`，`asOf` 支持同窗口多快照。

2. **P1 — Jobs & durability（进行中）**  
   - ✅ BullMQ + Redis：异步 `POST /v1/rankings/run`（`"async": true`），进程内 Worker (`RankingProcessor`)  
   - ✅ 幂等：`(topicRankingId, snapshotTime)` 唯一；`snapshotVersion` 采用 `${version}.${window}.${timestamp}`；任务 `jobId` 为 payload SHA-256  
   - ✅ `TopicRanking` 状态：`queued` → `running` → `completed` | `failed`  
   - ✅ **Transactional Outbox**：快照提交事务内写入 `OutboxEvent`；`OutboxPublisherService` 定时发往 Kafka 兼容 broker（默认 topic `ranking.snapshot.completed`）。未配置 `KAFKA_BROKERS` 时仅积累 outbox 并打日志。  
   - ✅ 本地 **Redpanda**：`docker compose` 中 `redpanda`，宿主机端口 **19092**（`.env` 中 `KAFKA_BROKERS=localhost:19092`）  
   - ✅ 多实例 **Outbox**：`leasedUntil` 租约 + `FOR UPDATE SKIP LOCKED` 抢占，避免并行重复发布  
   - ⏳ 爬虫 checkpoint（后续）

3. **P2 — Analytics & search**  
   ClickHouse、Elasticsearch、Redis 热榜缓存

4. **P3 — Agents & UI**  
   - ✅ **管理前端**：`web/` — Next.js App Router、Tailwind v4、shadcn/ui（Radix）、**深色主题**、**ECharts** 柱状图、对接现有 REST API  
   - ⏳ Agent 工具链、更完整的运营模块

## Web 管理端 (`web/`)

```bash
cd web
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3000
npm install
npm run dev   # 默认 http://localhost:3001
```

后端需开启 CORS（根目录 `.env` 已示例 `CORS_ORIGIN`，默认允许 `http://localhost:3001`）。先启动 API（`npm run start:dev` 在仓库根目录），再启动 `web`。

## Prereqs

- Docker：Postgres、Redis、**Redpanda**（Kafka 协议，`docker compose` 已配置）

### Kafka / Outbox

- `KAFKA_BROKERS`：可**留空**则仅写 Outbox、不连 broker（无 Redpanda 时不报错）。需要发布时再设为例如 `localhost:19092`。可选 `KAFKAJS_LOG_LEVEL=WARN` 排查连接。
- 可选：`KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED`、`KAFKA_CLIENT_ID`  
- 消息体：`{ type, payload, meta: { outboxId, createdAt } }`，`payload` 内含 `snapshotId`、`topicRankingId`、`topicVersionId` 等（字符串化 ID）  
- `OUTBOX_FLUSH_MS`：发布轮询间隔（毫秒，默认 2000）

## Run locally

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma migrate deploy
npm run start:dev
```

环境变量：`DATABASE_URL`、`REDIS_URL`（或 `REDIS_HOST` / `REDIS_PORT`）。**根目录须有 `.env`**（可从 `.env.example` 复制）；`npx prisma` 会自动读 `.env`，**跑应用**也会通过 `src/main.ts` 里的 `dotenv` 加载同一文件。

## Demo API

```bash
curl -s -X POST http://localhost:3000/admin/seed-demo -H 'Content-Type: application/json' -d '{}'
```

### 同步排行（小包络）

`POST /v1/rankings/run`，body 不含 `async` 或 `"async": false`。

### 异步排行（生产路径）

```bash
curl -s -X POST http://localhost:3000/v1/rankings/run \
  -H 'Content-Type: application/json' \
  -d '{"topicVersionId":"1","timeWindow":"WEEK","windowStart":"2026-05-10T00:00:00.000Z","windowEnd":"2026-05-17T00:00:00.000Z","asOf":"2026-05-20T12:00:00.000Z","async":true}'
# → { "jobId": "...", "topicRankingId": "..." }

curl -s http://localhost:3000/v1/jobs/ranking/<jobId>
curl -s http://localhost:3000/v1/rankings/<topicRankingId>/status
```

快照详情：`GET /v1/snapshots/{id}`（bigint 已转字符串）。
