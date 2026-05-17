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
   - ✅ **爬虫骨架**：`CrawlCheckpoint` REST；`Source` / `CrawlTask`；`CrawledUrl` 指纹去重；BullMQ 队列 `crawl` + 桩任务（`seedUrls` 写库，可换 Playwright）
3. **P2 — Analytics & search**  
   - ✅ **ClickHouse**：compose、`metric_timeseries`、`AnalyticsModule`；`SYNC_RANKING_TO_CLICKHOUSE` + `CLICKHOUSE_URL` 时 `CLICKHOUSE_WRITE_MODE=direct`（默认）快照后直写，`outbox` 则同事务插入专用 Outbox 行并由 `ClickhouseOutboxFlusherService` 刷入；Outbox 按 `type` 分流，Kafka 仅发布 `ranking.snapshot.completed`  
   - ✅ **Redis 热读缓存**：`GET /v1/snapshots/:id` 长 TTL；`GET /v1/topics/:slug/leaderboard` 独立短 TTL 聚合缓存；无 Redis 或失败时降级查库  
   - ⏳ Elasticsearch

4. **P3 — Agents & UI**  
   - ✅ **管理前端**：`web/` — Next.js App Router、Tailwind v4、shadcn/ui（Radix）、**深色主题**、**ECharts** 柱状图、对接现有 REST API  
   - ⏳ Agent 工具链、更完整的运营模块

## Priority （后续投入）

| 优先级 | 方向 | 说明 |
|--------|------|------|
| **1** | Redis 读路径 | ✅ 已做：快照详情缓存 + **slug 热榜聚合** `GET /v1/topics/:slug/leaderboard`。 |
| **2** | ClickHouse / Outbox | ✅ 已做：OLAP 与异步刷数。 |
| **3** | Elasticsearch | 实体/内容全文与复杂过滤；需同步管道与运维，放在 ES 之前完成「事实源 + 缓存」更划算。 |
| **4** | 真爬取（Playwright 等） | 替换桩；与数据源 SLA、反爬相关，随产品化渐进。 |

## Web 管理端 (`web/`)

```bash
cd web
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3000
npm install
npm run dev   # 默认 http://localhost:3001
```

后端需开启 CORS（根目录 `.env` 已示例 `CORS_ORIGIN`，默认允许 `http://localhost:3001`）。先启动 API（`npm run start:dev` 在仓库根目录），再启动 `web`。

## Prereqs

- Docker：Postgres、Redis（**BullMQ + 快照读缓存**）、**Redpanda**（Kafka 协议）、可选 **ClickHouse**

### 快照读缓存（Redis）

- 默认开启；单机不想连 Redis 时可设 `RANKING_CACHE_ENABLED=false`（关闭快照与热榜聚合两类缓存键；异步排行仍可能要 Redis）。  
- `RANKING_CACHE_TTL_SECONDS`：默认 `604800`（7 天，与不可变快照一致）。  
- `LEADERBOARD_CACHE_TTL_SECONDS`：默认 `120`；`GET /v1/topics/:slug/leaderboard` 的聚合 JSON（命中后短缓存，「最新窗口」语义用 TTL 消化变更）。  
- `RANKING_CACHE_REDIS_DB`：默认 `0`；与 BullMQ 共用实例时键前缀为 `ranking:v1:snap:`、`ranking:v1:lb:`，一般无需换 DB。  
- 排行物化成功后会 `warm` 缓存，首次读多走内存。

### ClickHouse（可选）

- 启动：`docker compose up -d clickhouse`；首次启动会执行 `clickhouse/docker-entrypoint-initdb.d/*.sql` 建库表。  
- `.env`：`CLICKHOUSE_URL=http://localhost:8123`（可选 `CLICKHOUSE_DATABASE=ranking`）；`SYNC_RANKING_TO_CLICKHOUSE=true` 打开排行快照 → OLAP。  
- `CLICKHOUSE_WRITE_MODE`：`direct`（默认）事务成功后立即写 CH；`outbox` 时在**同一 PG 事务**再插一条 Outbox（类型 `clickhouse.ranking.snapshot.ingest`），由 `ClickhouseOutboxFlusherService` 轮询写入，避免阻塞 API/Worker 主路径。  
- `GET /v1/analytics/clickhouse/health` 探活；`POST /v1/analytics/clickhouse/metrics` 可灌测试点（见 body 校验）。

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

### 热榜聚合（按 slug）

默认：该话题**最新 effectiveFrom** 的 `TopicVersion` + **最近完成的** `TopicRanking`（含快照）+ 该 ranking 下**最新 snapshotTime** 的快照。

可选查询串：`version`、`timeWindow`、`windowStart`（若带 `windowStart` 必须同时带 `timeWindow`）。响应为 `{ resolved, snapshot }`，其中 `snapshot` 与快照详情 API 同形。

```bash
curl -s 'http://localhost:3000/v1/topics/global-female-singers/leaderboard'
curl -s 'http://localhost:3000/v1/topics/global-female-singers/leaderboard?timeWindow=WEEK'
```

### 爬虫 / Checkpoint（桩）

```bash
# 数据源
curl -s -X POST http://localhost:3000/v1/crawl/sources \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo Feed","baseUrl":"https://example.com","kind":"demo"}'

# 同步任务：seedUrls 仅写库，不发起真实 HTTP
curl -s -X POST http://localhost:3000/v1/crawl/tasks \
  -H 'Content-Type: application/json' \
  -d '{"sourceId":"1","seedUrls":["https://example.com/a","https://example.com/b"]}'

# 异步任务（需 Redis）
curl -s -X POST http://localhost:3000/v1/crawl/tasks \
  -H 'Content-Type: application/json' \
  -d '{"sourceId":"1","async":true,"seedUrls":["https://example.com/c"]}'

curl -s http://localhost:3000/v1/crawl/tasks/1
curl -s http://localhost:3000/v1/crawl/checkpoints/source:1

# URL 幂等登记
curl -s -X POST http://localhost:3000/v1/crawl/urls \
  -H 'Content-Type: application/json' \
  -d '{"sourceId":"1","url":"https://example.com/doc?utm_source=x"}'
```

`PUT /v1/crawl/checkpoints/:crawlerName` 可手写断点（body：`lastCursor`、`lastUrl`、`lastTopic`、`lastProcessed` ISO 字符串）。
