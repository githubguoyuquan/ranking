# Ranking platform

## Priority & phased delivery

1. **P0 — Facts & evolution**  
   PostgreSQL + Prisma，不可变 `TopicRankSnapshot`，`RankingItem` 含 `previousRank` / `rankChange`，`RankingItemHistory`，`asOf` 支持同窗口多快照。

2. **P1 — Jobs & durability**  
   - ✅ BullMQ + Redis：异步 `POST /v1/rankings/run`（`"async": true`），进程内 Worker (`RankingProcessor`)  
   - ✅ 幂等：`(topicRankingId, snapshotTime)` 唯一；`snapshotVersion` 采用 `${version}.${window}.${timestamp}`；任务 `jobId` 为 payload SHA-256  
   - ✅ `TopicRanking` 状态：`queued` → `running` → `completed` | `failed`  
   - ✅ **Transactional Outbox**：快照提交事务内写入 `OutboxEvent`；`OutboxPublisherService` 定时发往 Kafka 兼容 broker（默认 topic `ranking.snapshot.completed`）。未配置 `KAFKA_BROKERS` 时仅积累 outbox 并打日志。  
   - ✅ 本地 **Redpanda**：`docker compose` 中 `redpanda`，宿主机端口 **19092**（`.env` 中 `KAFKA_BROKERS=localhost:19092`）  
   - ✅ 多实例 **Outbox**：`leasedUntil` 租约 + `FOR UPDATE SKIP LOCKED` 抢占，避免并行重复发布  
   - ✅ **爬虫**：Checkpoint / `Source` / `CrawlTask` / `CrawledUrl` + BullMQ `crawl`；**可选真 HTTP**（`CRAWL_HTTP_FETCH` 或 `kind: http-fetch`）或 **Playwright**（`CRAWL_USE_PLAYWRIGHT` / `kind: http-playwright`）：`contentHash`、`textPreview`、基础 SSRF；未开真抓取时仍为桩 `fetched_stub`
3. **P2 — Analytics & search**  
   - ✅ **ClickHouse**：compose、`metric_timeseries`、`AnalyticsModule`；`SYNC_RANKING_TO_CLICKHOUSE` + `CLICKHOUSE_URL` 时 `CLICKHOUSE_WRITE_MODE=direct`（默认）快照后直写，`outbox` 则同事务插入专用 Outbox 行并由 `ClickhouseOutboxFlusherService` 刷入；Outbox 按 `type` 分流，Kafka 仅发布 `ranking.snapshot.completed`  
   - ✅ **Redis 热读缓存**：`GET /v1/snapshots/:id` 长 TTL；`GET /v1/topics/:slug/leaderboard` 独立短 TTL 聚合缓存；无 Redis 或失败时降级查库  
   - ✅ **Elasticsearch（骨架）**：compose、`SearchModule`、**双索引** `ranking_entities`（实体）与 **`ranking_crawled_urls`（爬取 URL + textPreview）**；启用 ES 时实体写入走 Outbox（`elasticsearch.entity.sync`），**爬取任务**在 PG 事务内写入 **`elasticsearch.crawled_url.sync`**，由 **`ElasticCrawledUrlOutboxFlusherService`** 异步 upsert/delete；`GET /v1/search/crawled-urls-es`、`POST /admin/reindex-crawl-docs`；`admin/entities`、`seed-demo` 已接入实体侧；未配 `ELASTICSEARCH_NODE` 时仅 PG、无相关 Outbox 刷 ES

4. **P3 — Agents & UI**  
   - ✅ **管理前端**：`web/` — Next.js、快照图表、**搜索**（页眉拉取 `GET /v1/search/health`）/ **索引**（`POST /admin/reindex-*`）/ **实体 / 爬虫**（异步任务 + 轮询 `GET /v1/crawl/tasks/:id`）、快照页 **Agent 简报**按钮  
   - ✅ **Agent（最小）**：`POST /admin/snapshots/:id/analyze` → `AiAnalysis`；`GET /v1/snapshots/:id/analyses`；可选 `OPENAI_API_KEY` 调 GPT；生产需鉴权、配额与审计  
   - ✅ **Playwright 爬取**：`CRAWL_USE_PLAYWRIGHT` 或 `Source.kind=http-playwright`；依赖 `playwright` + `npx playwright install chromium`  
   - ✅ **Elasticsearch 高亮**：实体与 `ranking_crawled_urls` 检索返回 `<em>` 高亮片段（管理台搜索页展示）

## Priority （后续投入）

| 优先级 | 方向 | 说明 |
|--------|------|------|
| **1** | Redis 读路径 | ✅ 已做：快照详情缓存 + **slug 热榜聚合** `GET /v1/topics/:slug/leaderboard`。 |
| **2** | ClickHouse / Outbox | ✅ 已做：OLAP 与异步刷数。 |
| **3** | Elasticsearch | ✅ 骨架 + Outbox + **检索高亮**；跨集群属运维/配置（多节点 `ELASTICSEARCH_NODE` 或 SLM 不在本仓库展开） |
| **4** | 真爬取 | ✅ HTTP GET + **Playwright** + 摘要入 PG/ES；⏳ 更细 DOM 特征与反爬策略需按业务继续加 |

## Web 管理端 (`web/`)

```bash
cd web
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3000
npm install
npm run dev   # 默认 http://localhost:3001
```

后端需开启 CORS（根目录 `.env` 已示例 `CORS_ORIGIN`，默认允许 `http://localhost:3001`）。先启动 API（`npm run start:dev` 在仓库根目录），再启动 `web`。

## Prereqs

- Docker：Postgres、Redis（**BullMQ + 快照读缓存**）、**Redpanda**（Kafka 协议）、可选 **ClickHouse**、可选 **Elasticsearch**（`9200`）

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

### Elasticsearch（可选）

- 启动：`docker compose up -d elasticsearch`（首次拉镜像较慢；单节点 dev，**无安全认证**，勿暴露公网）。  
- `.env`：`ELASTICSEARCH_NODE=http://localhost:9200`；可选 `ELASTICSEARCH_INDEX_ENTITIES=ranking_entities`、`ELASTICSEARCH_INDEX_CRAWLED_URLS=ranking_crawled_urls`。  
- 流程：**Outbox（推荐）**—— 启用 ES 时，`POST/PATCH /admin/entities` 与 `seed-demo` 在 PG 事务内写入 `OutboxEvent`（`elasticsearch.entity.sync`），进程内 **`ElasticEntityOutboxFlusherService`**（与 `OUTBOX_FLUSH_MS` 同频）在**提交后** upsert/delete 实体索引；`DELETE /admin/entities` 先写 `delete` Outbox 再删 PG 行。**爬取**：每条 `CrawledUrl` 写入（桩/失败/成功）同事务插入 **`elasticsearch.crawled_url.sync`**，由 **`ElasticCrawledUrlOutboxFlusherService`** 维护 `ranking_crawled_urls`（仅 `status=fetched` 时为正文 upsert，否则删 ES）。**兜底**——旁路写库后执行 `POST /admin/reindex-entities` 或 **`POST /admin/reindex-crawl-docs`**。  
- `POST /admin/entities` 在启用 ES 时**不再同步直写**，创建成功与索引最终一致；搜索可能有秒级延迟。  
- 其它代码路径变更 `Entity` 时，请在同一事务内调用 `elasticEntitySyncOutboxCreate(id, 'upsert'|'delete')` 写入 Outbox（见 `src/search/elastic-entity-outbox.ts`），避免未提交数据出现在 ES。变更 **`CrawledUrl`** 收录逻辑时沿用 `elasticCrawledUrlSyncOutboxCreate`（`src/search/elastic-crawled-url-outbox.ts`）。  
- **`GET /v1/search`**：一次返回 **实体**与 **爬取 URL**。实体：`entityIndex=auto|es|pg`（默认 auto：有 ES 用全文索引，**否则 PostgreSQL** `canonicalName` + JSON `aliases` 子串）；`entityIndex=pg` 强制 PG。爬取：`crawlIndex`、可选 `sourceId` / `status`；爬取 `q` 需 ≥2 字符。  
- **`GET /v1/search/entities`**：`engine=es|pg|auto`（默认 **es**：未配 ES 仍 **503**）；**pg** 与聚合里的 PG 实体逻辑一致；**auto** 同 `entityIndex=auto`。响应含 **`engine`**：`elasticsearch` | `postgresql`。  
- `GET /v1/search/health`：集群探活；未配置 `ELASTICSEARCH_NODE` 时返回 `ok: false`。  
- **`GET /v1/search/crawled-urls`**（PostgreSQL）：`url` / `textPreview` 子串；可选 `sourceId`、`status`；`q` 至少 2 字符。  
- **`GET /v1/search/crawled-urls-es`**（Elasticsearch）：`url` / `textPreview` 全文；参数同上；需 ES。

### Kafka / Outbox

- `KAFKA_BROKERS`：可**留空**则仅写 Outbox、不连 broker（无 Redpanda 时不报错）。需要发布时再设为例如 `localhost:19092`。可选 `KAFKAJS_LOG_LEVEL=WARN` 排查连接。
- 可选：`KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED`、`KAFKA_CLIENT_ID`  
- 消息体：`{ type, payload, meta: { outboxId, createdAt } }`，`payload` 内含 `snapshotId`、`topicRankingId`、`topicVersionId` 等（字符串化 ID）  
- `OutboxEvent.type` 另有 `clickhouse.ranking.snapshot.ingest`、`elasticsearch.entity.sync`、`elasticsearch.crawled_url.sync` 等，由各自 **进程内 Flusher** 消费，**不会**随 Kafka 发布。  
- **运维排查**：`GET /admin/outbox?limit=50&pendingOnly=true&type=...` 只读列出积压行（无鉴权，勿暴露公网）。  
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

### 实体搜索（Elasticsearch + PG）

需 ES 运行且 `.env` 配置 `ELASTICSEARCH_NODE` 时，`/v1/search/entities` 默认走 ES 并返回 **`highlights`**（`<em>` 包裹命中词）。`GET /admin/entities` 列出实体（运营台与脚本）。

```bash
curl -s 'http://localhost:3000/v1/search?q=Swift&limit=12&entityIndex=auto'
curl -s 'http://localhost:3000/v1/search?q=Dee&entityIndex=pg'
curl -s 'http://localhost:3000/v1/search?q=example&crawlIndex=pg&sourceId=1&status=fetched'
curl -s http://localhost:3000/v1/search/health
curl -s -X POST http://localhost:3000/admin/entities \
  -H 'Content-Type: application/json' \
  -d '{"canonicalName":"Demo Singer","type":"PERSON","aliases":["Dee","Demo"]}'
curl -s -X PATCH http://localhost:3000/admin/entities/1 -H 'Content-Type: application/json' -d '{"aliases":[]}'
curl -s 'http://localhost:3000/v1/search/entities?q=Swift&limit=5&engine=auto'
curl -s 'http://localhost:3000/v1/search/entities?q=Dee&engine=pg'
curl -s 'http://localhost:3000/admin/entities?limit=10'
curl -s -X POST http://localhost:3000/admin/snapshots/1/analyze -H 'Content-Type: application/json' -d '{}'
curl -s http://localhost:3000/v1/snapshots/1/analyses
curl -s 'http://localhost:3000/v1/search/crawled-urls?q=example&limit=10'
curl -s 'http://localhost:3000/v1/search/crawled-urls-es?q=example&limit=10'
# 可选 &sourceId=1&status=fetched
# 全量修复索引（旁路写库后）
curl -s -X POST http://localhost:3000/admin/reindex-entities -H 'Content-Type: application/json' -d '{}'
curl -s -X POST http://localhost:3000/admin/reindex-crawl-docs -H 'Content-Type: application/json' -d '{}'
```

### 爬虫 / Checkpoint

- **默认**：`seedUrls` 仅写入 `CrawledUrl`，`status=fetched_stub`（无网络）。  
- **真 HTTP**：`.env` 设 `CRAWL_HTTP_FETCH=true`，或创建数据源时 `"kind":"http-fetch"`；任务对每条 URL 执行 GET，计算 body **SHA256** 写入 `contentHash`，`status=fetched`；失败为 `fetch_failed`，被 SSRF 规则拦截为 `fetch_blocked`。可选：`CRAWL_FETCH_TIMEOUT_MS`、`CRAWL_MAX_RESPONSE_BYTES`、`CRAWL_USER_AGENT`。  
- 成功行写入 `mimeType`、去标签后的 **`textPreview`**（仅文本类 MIME；长度见 `CRAWL_TEXT_PREVIEW_CHARS`），便于检索与后续接 ES。  
- `GET /v1/crawl/sources/:sourceId/urls?limit=50` 查看最新 `CrawledUrl` 行（含摘要）。

```bash
curl -s -X POST http://localhost:3000/v1/crawl/sources \
  -H 'Content-Type: application/json' \
  -d '{"name":"Example","baseUrl":"https://example.com","kind":"http-fetch"}'
curl -s -X POST http://localhost:3000/v1/crawl/tasks \
  -H 'Content-Type: application/json' \
  -d '{"sourceId":"1","seedUrls":["https://example.com/"]}'
curl -s 'http://localhost:3000/v1/crawl/sources/1/urls?limit=10'
```

### 爬虫旧示例（桩 kind=demo）

```bash
# 数据源
curl -s -X POST http://localhost:3000/v1/crawl/sources \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo Feed","baseUrl":"https://example.com","kind":"demo"}'

# 同步任务：未开真 HTTP 时 seedUrls 仅写 stub
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
