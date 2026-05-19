# Ranking platform

完整产品愿景、与当前实现的**差距对照**、目标架构（DDD/消息/规模演进）见 **[docs/PLATFORM_ARCHITECTURE.md](docs/PLATFORM_ARCHITECTURE.md)**。

## Priority & phased delivery

1. **P0 — Facts & evolution**  
   PostgreSQL + Prisma，不可变 `TopicRankSnapshot`，`RankingItem` 含 `previousRank` / `rankChange`，`RankingItemHistory`，`asOf` 支持同窗口多快照。

2. **P1 — Jobs & durability**  
   - ✅ BullMQ + Redis：异步 `POST /v1/rankings/run`（`"async": true`），进程内 Worker (`RankingProcessor`)  
   - ✅ **排行编排（Phase B 起点）**：快照物化成功后入队 **`ranking-followup`**（`post-snapshot`），`RankingFollowupProcessor` 打日志；可选 `RANKING_FOLLOWUP_OUTBOX=true` 写 `OutboxEvent` 类型 `ranking.followup.requested`（**不**经当前 Kafka publisher，仅占位可观测）；`RANKING_FOLLOWUP_DISABLED=true` 跳过入队  
   - ✅ 幂等：`(topicRankingId, snapshotTime)` 唯一；`snapshotVersion` 采用 `${version}.${window}.${timestamp}`；任务 `jobId` 为 payload SHA-256  
   - ✅ `TopicRanking` 状态：`queued` → `running` → `completed` | `failed`  
   - ✅ **Transactional Outbox**：快照提交事务内写入 `OutboxEvent`；`OutboxPublisherService` 定时发往 Kafka 兼容 broker（默认 topic `ranking.snapshot.completed`）。未配置 `KAFKA_BROKERS` 时仅积累 outbox 并打日志。  
   - ✅ 本地 **Redpanda**：`docker compose` 中 `redpanda`，宿主机端口 **19092**（`.env` 中 `KAFKA_BROKERS=localhost:19092`）  
   - ✅ 多实例 **Outbox**：`leasedUntil` 租约 + `FOR UPDATE SKIP LOCKED` 抢占，避免并行重复发布  
   - ✅ **爬虫**：Checkpoint / `Source` / `CrawlTask` / `CrawledUrl` + BullMQ `crawl`；**`GET /v1/crawl/tasks`** 按 `limit`（1–100，默认 30）、可选 **`sourceId`** 列出近期任务（引擎监控 / 运营排障）；**可选真 HTTP**（`CRAWL_HTTP_FETCH` 或 `kind: http-fetch`）或 **Playwright**（`CRAWL_USE_PLAYWRIGHT` / `kind: http-playwright`）：`contentHash`、`textPreview`、基础 SSRF；**`CRAWL_HTTP_PROXY` / `Source.httpProxyUrl`** 出站代理；**多实例**共用 Redis 消费同一 `crawl` 队列（`npm run start:crawl-worker` 独立 Worker 进程）；**`CRAWL_PER_HOST_MIN_INTERVAL_MS`** Redis 同 host 节流；**`CRAWL_SEMANTIC_DEDUP`** + `OPENAI_API_KEY` 时同信源正文 embedding 去重（`fetched_semantic_dup` / `duplicateOfId`，不重复入 ES）；未开真抓取时仍为桩 `fetched_stub`
3. **P2 — Analytics & search**  
   - ✅ **ClickHouse**：compose、`metric_timeseries`、`AnalyticsModule`；`SYNC_RANKING_TO_CLICKHOUSE` + `CLICKHOUSE_URL` 时 `CLICKHOUSE_WRITE_MODE=direct`（默认）快照后直写，`outbox` 则同事务插入专用 Outbox 行并由 `ClickhouseOutboxFlusherService` 刷入；Outbox 按 `type` 分流，Kafka 仅发布 `ranking.snapshot.completed`  
   - ✅ **Redis 热读缓存**：`GET /v1/snapshots/:id` 长 TTL；`GET /v1/topics/:slug/leaderboard` 独立短 TTL 聚合缓存；无 Redis 或失败时降级查库  
   - ✅ **主检索（Qdrant 优先）**：`QDRANT_URL` + `SEARCH_PRIMARY=auto`（默认 **Qdrant → ES → PG**）；`QdrantSearchService` 双 collection `ranking_entities` / `ranking_crawled_urls`（全文 `searchText` + 向量 kNN）；Outbox 与 ES **并行双写**（同一 `elasticsearch.*.sync` flusher）；`GET /v1/search/health` 返回 `primary` / `qdrant` / `elastic`；`POST /admin/reindex-entities` / `reindex-crawl-docs` 按主引擎灌库  
   - ✅ **Elasticsearch（骨架，可选）**：compose、`SearchModule`、**双索引** `ranking_entities`（实体）与 **`ranking_crawled_urls`（爬取 URL + textPreview）**；启用 ES 时实体写入走 Outbox（`elasticsearch.entity.sync`），**爬取任务**在 PG 事务内写入 **`elasticsearch.crawled_url.sync`**，由 **`ElasticCrawledUrlOutboxFlusherService`** 异步 upsert/delete；`GET /v1/search/crawled-urls-es`、`POST /admin/reindex-crawl-docs`；`admin/entities`、`seed-demo` 已接入实体侧；未配 `ELASTICSEARCH_NODE` 且未配 `QDRANT_URL` 时仅 PG、无相关 Outbox 刷索引

4. **P3 — Agents & UI**  
   - ✅ **管理前端**：`web/` — Next.js、快照图表、**搜索**（页眉 `GET /v1/search/health`；`/search?q=&limit=&entityIndex=&crawlIndex=&sourceId=&status=` 预填表单；**`limit` 前端钳制 1–30 与 DTO 一致**；**提交检索后地址栏与请求参数对齐**；**命中实体名可再点进同名检索**；**ES health 新标签 JSON**；**与表单一致的 GET /v1/search 新标签**、**复制 API URL**；**q 为空时主检索框 Enter 不提交**（与「搜索」按钮一致）；**limit/sourceId/status 在已有 q 时 Enter 触发搜索**（**sourceId 非空须十进制 ≤38 位**）/ **索引**（`POST /admin/reindex-*`；**`/reindex` 页脚 `GET /v1/search/health` 新标签**）/ **实体 / 爬虫**（`/entities?q=` 预填；列表 **q 最多 200 字符**（与聚合搜索一致）；**新标签打开当前 `GET /admin/entities`**；**新建/编辑 Enter 提交**；**canonicalName 为空时不 POST/PATCH**；**PATCH/DELETE 路径 id 须十进制（前端预校验）**；名称列→搜索；**爬虫**页 **数据源列表加载后自动选用首条**（避免空库误请求 id=1）、**新标签** `GET /v1/crawl/sources` / **当前 source urls**；**新建源 Enter**：**name/baseUrl 均非空**；**可选 trustTier 1–5（与 DTO 一致，表列 tier）、topicId（十进制，可空）**；**任务区**：**sourceId（十进制 ≤38 位）与 seedUrl 均非空**方可提交（与按钮一致）；**GET 任务列表**（全量或当前 source）可 **新标签打开 / 复制 URL**；异步 + 轮询 `GET /v1/crawl/tasks/:id`（**轮询前校验任务 id 为十进制**）、**话题**（热榜区 **复制 snapshotId / topicVersionId**；**新标签**当前 **versions / leaderboard**；**热榜 windowStart 非空时校验 ISO**；**slug/version/timeWindow/windowStart 框与 URL 预填截断（160/64/16/80）**）、**演示数据**（slug **Enter** · **复制**快照 ids / topicVersionId；成功写入后页脚 **首张快照**、**本批对比** 与 **索引/爬虫/Outbox** 等链）、**运行排行**（**topicVersionId** 未填不提交；**填写时校验十进制 id（≤38 位，与 BigInt 一致）**；**timeWindow / ISO 框 maxLength 16/80**；**提交前校验** `timeWindow` 枚举与 **ISO** 窗口时间；**演示数据**链至 **`/rankings/run?topicVersionId=`**；各框 **Enter** · **复制 POST 体**；**异步** **GET job / ranking status** 新标签与 **复制 id**）、**Outbox limit/type Enter**、根级 **loading / error**、快照 **Agent 简报**  
   - ✅ **多 Agent 编排**：BullMQ 队列 **`ai-agent`**、`AgentRun` / `TopicProposal` / `TopicMergeAudit`；**`topic-discovery-v1`**（爬取标题聚类 → 提案）、**`topic-merge-v1`**（相似度 + 迁移 `Source`）、**`fact-check-v1`**（跨信源指标冲突 → `AiAnalysis`）、**`duplicate-detection-v1`**；管理台 **`/agents`**；`GET/POST /admin/agents/*`（见 `.env.example` **`AI_AGENT_*`**）
   - ✅ **Agent（最小）**：`POST /admin/snapshots/:id/analyze` → `AiAnalysis`；body 可选 **`agent`（≤120）**、**`topN`（1–50）**、**`chainContext`（≤8192，有 `OPENAI_API_KEY` 时写入 user 前缀）**；约定名 **`rules-v1`**（默认）、**`post-snapshot-summary-v1`** / **`trend-v1`** / **`credibility-v1`**（后两者可由 `ranking-followup` 选配，`detailJson.agentKind` 分别为 `followup` / `trend` / `credibility`）；`GET /v1/snapshots/:id/analyses` 返回 **`{ filter, total, analyses }`**，可选 **`agentKind`**、**`agent`**、**`limit`（1–200，默认 50）**、**`offset`**；可选 `OPENAI_API_KEY` 调 GPT；**`AI_ANALYSIS_DAILY_CAP`**（UTC 日 **`AiAnalysis` 条数**）；**`AI_EMBEDDING_DAILY_CAP`**（UTC 日 **成功 embedding 批次数**，一次 `embedMany` 计 1）、**`AI_EMBEDDING_AUDIT`**（默认开启；`false` 不写 **`AiAuditEvent`**）；**`GET /admin/ai/spectrum`** / **`GET /admin/ai/audit-events`**（可筛 `category`、`source`）；生产需正式鉴权；**`RANKING_FOLLOWUP_ANALYZE_PIPELINE`**（非空则**仅**按逗号顺序跑多步、后续步将前序摘要写入 user 前缀；见 `.env.example`）或 **`RANKING_FOLLOWUP_ANALYZE`** / **`RANKING_FOLLOWUP_ANALYZE_TREND`** / **`RANKING_FOLLOWUP_ANALYZE_CREDIBILITY`**；共用 **`RANKING_FOLLOWUP_ANALYZE_TOPN`**；返回体含 **`analyzePipeline`**、**`analyzedSummary`** / **`analyzedTrend`** / **`analyzedCredibility`**（流水线中含 **`rules-v1`** 等时仍可能 **`analyzed`** 为 true）；**`detailJson.usedChainContext`** 标记链式上文；管理台快照详情 **Agent 区**提供 **可选表单（与 DTO 一致）**、**新标签打开 analyses**、**复制 GET / POST URL**、`aria-live` 状态；得分分布图容器带 **简要 `aria-label`（读屏）**  
   - ✅ **热榜实时（SSE）**：`GET /v1/realtime/stream`（Redis Pub/Sub；管理台话题页 / 运行排行页订阅 **`topics`** 或 **`topicRankingIds`**；事件 **`snapshot_ready`** / **`ranking_failed`**）  
   - ✅ **Playwright 爬取**：`CRAWL_USE_PLAYWRIGHT` 或 `Source.kind=http-playwright`；依赖 `playwright` + `npx playwright install chromium`  
   - ✅ **Elasticsearch 高亮**：实体与 `ranking_crawled_urls` 检索返回 `<em>` 高亮片段（管理台搜索页展示）

## 微服务进程 / Kafka 事件网 / 多 AZ（已实现骨架）

- **进程拆分**：`PROCESS_ROLE=api|worker|crawl|all`；`npm run start:platform-worker`、`start:crawl-worker`；见 `docs/architecture/SERVICE_BOUNDARIES.md`
- **Kafka 全量路由**：7 类 Outbox 事件 + `kafkaPublishedAt` 与 ES/CH `publishedAt` 双轨；`GET /admin/kafka/events`；`docs/kafka/EVENT_CATALOG.md`
- **Schema Registry**：`KAFKA_SCHEMA_REGISTRY_URL`（Redpanda `18081` / Confluent 兼容 REST）
- **生产 Helm**：`deploy/helm/ranking/` 多 Deployment + PDB + topologySpread；`docs/ops/PRODUCTION.md`
- **Dockerfile**：同镜像 `ranking-platform`，按 command 区分 API/Worker

## Phase C / D — 规模与合规（已实现骨架）

**规模（Phase C）**

- `DATABASE_READ_URL`：只读副本；`rank-history` / `trends/hot` 走 `PrismaReadService`
- `GET /admin/scale/status`；`POST /admin/scale/postgres/ensure-partitions`；`POST /admin/scale/elasticsearch/bootstrap-aliases` / `rollover-*`
- `CRAWL_PROXY_POOL`、`CRAWL_QUEUE_SHARD`、`CRAWL_SEMANTIC_DEDUP_CROSS_SOURCE`
- 管理台 **`/scale`**

**合规（Phase D）**

- `Tenant` / `ApiKey`（`X-API-Key` 或 `Authorization: Bearer`）；`API_AUTH_REQUIRED` / `API_ADMIN_OPEN`
- `Entity.piiLevel`（`NONE` | `LOW` | `HIGH`）；导出时对 HIGH 脱敏（非 admin scope）
- `GET /admin/compliance/snapshots/:id/export?format=json|csv`；`ComplianceAuditEvent`
- 管理台 **`/compliance`**

迁移：`npx prisma migrate deploy`（含 `20260519120000_phase_cd_scale_compliance`、`20260519150000_roadmap_entity_stats_fingerprint`）。

## 路线图落地（§15 可代码化部分）

- **Phase A**：`EntityTopicStats` 物化、`policyJson.decay`、`TopicKind` 预设、`GET /v1/analytics/snapshots/:id/metrics`、UTC 日 `periodic_rollup` 定时任务  
- **Phase B**：follow-up 写 `trendSummary` / `generatedByAi`；租户 `settingsJson.aiAnalysisDailyCap`  
- **Phase C/D**：沿用既有 scale/compliance；compose 增 **MinIO / Qdrant**；`deploy/helm/ranking` 骨架  
- 详见 `docs/PLATFORM_ARCHITECTURE.md` §5.1 / §15

## BI 大屏

管理台 **`/bi`**（侧栏「BI 大屏」）：全屏 KPI + ECharts（14 日快照量、趋势标签分布、涨榜 Top10）+ 依赖健康 + 最新快照表；数据来自 **`GET /admin/bi/overview`**（30s 自动刷新）。进入页默认隐藏侧栏，Esc /「退出全屏」恢复。

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

根布局导出 **`viewport`**（`width=device-width`）以移动端缩放一致。

后端需开启 CORS（根目录 `.env` 已示例 `CORS_ORIGIN`，默认允许 `http://localhost:3001`）。先启动 API（`npm run start:dev` 在仓库根目录），再启动 `web`。

运营台与 Nest 之间的 **HTTP 路径别名**（相对路径）：`web/src/lib/nest-api-paths.ts`（`/v1`）、`web/src/lib/backend-api-paths.ts`（`/health` 与 `/admin`）；请求 URL 封装在 `nest-api-urls.ts`、`backend-api-urls.ts`（均经 `apiUrl()`）。

各管理子页（**含概览 /**）**页脚**由组件 **`AdminFooterNav`**（语义为 **`nav[aria-label=管理台页脚导航]`**）渲染，顺序为：**运行排行** → **索引维护** → **爬虫** → **Outbox** → **聚合搜索** → **实体** → **话题版本** → **快照对比** → **演示数据**；概览传 `showBackToHome={false}`（不缀「返回概览」）。其余子页在末尾多 **← 返回概览**。支持 **`leading`** 插槽（如快照 JSON 链、索引页 ES health）、**`/reindex` / `crawl` / `outbox` 页脚**带 `text-muted-foreground`。**全局 404、`/snapshots/:id` 未找到、根 `error.tsx`** 底部也挂同一导航以便逃生。**`loading.tsx`** 在加载态同样渲染页脚（无「返回概览」）。**`#admin-main`** 具 **`aria-label="正文内容"`**；键盘 **Tab** 先聚焦 **「跳到正文」** 再进入该区域。侧栏带 **`aria-label`**，底部 **API 基址**与 **`getApiBase()`** 一致；数据表列标题普遍使用 **`scope="col"`**，首个标识列（实体 id、Outbox id、数据源 id、排行名次、话题 version、快照对比实体名等）使用 **`scope="row"`** 且 **`font-normal`** 抵消默认表头加粗；**实体 / 爬虫**等表单字段普遍 **`Label` 与 `Input`/`select` 用 `htmlFor`/`id` 成对**。**复制类按钮**在**无可复制文本**时 **禁用**；否则带 **`aria-label`** 与截断 **`title`（悬停预览全文）**。

## Prereqs

- **Lint / TypeScript**：**`npm run lint:all`**：依次执行 **Nest `eslint`（`src/**/*.ts`）**、**web ESLint** 与 **`web` `tsc --noEmit`**。也可单独：**`npm run lint`**（根）、**`npm run lint:web`**、**`npm run typecheck --prefix web`**。
- Docker：Postgres、Redis（**BullMQ + 快照读缓存**）、**Redpanda**（Kafka 协议）、可选 **ClickHouse**、可选 **Elasticsearch**（`9200`）

### 快照读缓存（Redis）

- 默认开启；单机不想连 Redis 时可设 `RANKING_CACHE_ENABLED=false`（关闭快照与热榜聚合两类缓存键；异步排行仍可能要 Redis）。  
- `RANKING_CACHE_TTL_SECONDS`：默认 `604800`（7 天，与不可变快照一致）。  
- `LEADERBOARD_CACHE_TTL_SECONDS`：默认 `120`；`GET /v1/topics/:slug/leaderboard` 的聚合 JSON（命中后短缓存，「最新窗口」语义用 TTL 消化变更）。  
- `RANKING_CACHE_REDIS_DB`：默认 `0`；与 BullMQ 共用实例时键前缀为 **`ranking:v2:snap:`**（快照 JSON）、**`ranking:v3:lb:`**（热榜聚合），一般无需换 DB。  
- 排行物化成功后会 `warm` 缓存，首次读多走内存。

### ClickHouse（可选）

- 启动：`docker compose up -d clickhouse`；首次启动会执行 `clickhouse/docker-entrypoint-initdb.d/*.sql` 建库表。  
- `.env`：`CLICKHOUSE_URL=http://localhost:8123`（可选 `CLICKHOUSE_DATABASE=ranking`）；`SYNC_RANKING_TO_CLICKHOUSE=true` 打开排行快照 → OLAP。  
- `CLICKHOUSE_WRITE_MODE`：`direct`（默认）事务成功后立即写 CH；`outbox` 时在**同一 PG 事务**再插一条 Outbox（类型 `clickhouse.ranking.snapshot.ingest`），由 `ClickhouseOutboxFlusherService` 轮询写入，避免阻塞 API/Worker 主路径。  
- `GET /v1/analytics/clickhouse/health` 探活；`POST /v1/analytics/clickhouse/metrics` 可灌测试点（见 body 校验）。

### Elasticsearch（可选）

- 启动：`docker compose up -d elasticsearch`（首次拉镜像较慢；单节点 dev，**无安全认证**，勿暴露公网）。  
- `.env`：`ELASTICSEARCH_NODE=http://localhost:9200`；可选 `ELASTICSEARCH_INDEX_ENTITIES=ranking_entities`、`ELASTICSEARCH_INDEX_CRAWLED_URLS=ranking_crawled_urls`。  
- 流程：**Outbox（推荐）**—— 启用 ES 时，`POST/PATCH /admin/entities` 与 `seed-demo` 在 PG 事务内写入 `OutboxEvent`（`elasticsearch.entity.sync`），进程内 **`ElasticEntityOutboxFlusherService`**（与 `OUTBOX_FLUSH_MS` 同频）在**提交后** upsert/delete 实体索引（**配置了 `OPENAI_API_KEY` 时 Flusher 写入会带 `embedding`**，失败则降级为仅全文字段）；`DELETE /admin/entities` 先写 `delete` Outbox 再删 PG 行。**爬取**：每条 `CrawledUrl` 写入（桩/失败/成功）同事务插入 **`elasticsearch.crawled_url.sync`**，由 **`ElasticCrawledUrlOutboxFlusherService`** 维护 `ranking_crawled_urls`（仅 `status=fetched` 时为正文 upsert，否则删 ES）。**兜底**——旁路写库后执行 `POST /admin/reindex-entities` 或 **`POST /admin/reindex-crawl-docs`**（实体全量重索引会**批量**调用 Embeddings 补向量）。  
- `POST /admin/entities` 在启用 ES 时**不再同步直写**，创建成功与索引最终一致；搜索可能有秒级延迟。  
- 其它代码路径变更 `Entity` 时，请在同一事务内调用 **`elasticEntitySyncOutboxCreate(id, 'upsert'|'delete')`** 写入 Outbox（**`payload` 形状**见 **`src/search/elastic-entity-sync-outbox-payload.ts`**，**`type` + `payload` 封装**见 **`src/search/elastic-entity-outbox.ts`**），避免未提交数据出现在 ES。变更 **`CrawledUrl`** 收录逻辑时沿用 **`elasticCrawledUrlSyncOutboxCreate`**（**`payload`**：`src/search/elastic-crawled-url-sync-outbox-payload.ts`；**封装**：`src/search/elastic-crawled-url-outbox.ts`）。  
- **`GET /v1/search`**：一次返回 **实体**与 **爬取 URL**；`q` 必填（1–200 字符）；**`limit` 可选、整数 1–30**（管理台表单与复制 URL 会将非法或过大的 `limit` 钳到该范围）。实体：`entityIndex=auto|es|pg`（默认 auto：有 ES 用全文索引，**否则 PostgreSQL** `canonicalName` + JSON `aliases` 子串）；`entityIndex=pg` 强制 PG；**`entitySemantic=1|true`** 时实体块改为 **OpenAI 嵌入 + ES kNN**（需 **`OPENAI_API_KEY` + `ELASTICSEARCH_NODE`**；索引需已 `putMapping` 出 `embedding` 字段，旧集群首次可 `POST /admin/reindex-entities`）。爬取：`crawlIndex`、可选 `sourceId`（若传须为十进制、与 `BigInt` 解析一致；`@MaxLength(64)`）/ `status`（≤64 字符）；爬取 `q` 需 ≥2 字符。管理台在 **提交前**校验可选 `sourceId` 为十进制（与 `BigInt` 一致）。管理台搜索页在 **爬取 URL** 命中上提供 **「限定该 source」**（以本次检索的 `q` + 该行的 `sourceId` 预填）；实体命中可链至 **`/entities?q=`** 打开后台列表。  
- **`GET /v1/search/entities`**：`engine=es|pg|auto`（默认 **es**：未配 ES 仍 **503**）；**pg** 与聚合里的 PG 实体逻辑一致；**auto** 同 `entityIndex=auto`；**`semantic=1|true`** 时强制 ES kNN（需 **`OPENAI_API_KEY`**）。响应含 **`engine`**：`elasticsearch` | `postgresql`，向量模式另含 **`mode: vector`**。  
- **`GET /v1/recommendations/similar-topics?topicId=&limit=`**：基于表 **`TopicEmbedding`**（`title+slug` 文本嵌入）；首次调用会**批量**补全缺失行（OpenAI）。  
- **`GET /v1/recommendations/similar-entities?entityId=&limit=`**：ES kNN；锚点实体无向量时会现算并 **`upsertEntityFromRow`** 写回索引。  
- `GET /v1/search/health`：集群探活；未配置 `ELASTICSEARCH_NODE` 时返回 `ok: false`。  
- **`GET /v1/search/crawled-urls`**（PostgreSQL）：`url` / `textPreview` 子串；可选 `sourceId`、`status`；`q` 至少 2 字符。  
- **`GET /v1/search/crawled-urls-es`**（Elasticsearch）：`url` / `textPreview` 全文；参数同上；需 ES。

### Kafka / Outbox

- `KAFKA_BROKERS`：可**留空**则仅写 Outbox、不连 broker（无 Redpanda 时不报错）。需要发布时再设为例如 `localhost:19092`。可选 `KAFKAJS_LOG_LEVEL=WARN` 排查连接。
- 可选：`KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED`、`KAFKA_CLIENT_ID`  
- **事件网 / Schema**：Kafka 消息 JSON 见 **`docs/kafka/EVENT_CATALOG.md`**（`envelopeVersion: 1` + `type` + `payload` + `meta`）；发布前 AJV 校验（`KAFKA_SKIP_SCHEMA_VALIDATION=true` 仅应急关闭）。
- 消息体（Envelope v1）：`envelopeVersion`、`type`、`payload`（如 `ranking.snapshot.completed` 时内含 `schemaVersion: 1` 与 `snapshotId`、`topicRankingId`、`topicVersionId` 等）、`meta: { outboxId, createdAt }`；payload 字段集由 **`buildRankingSnapshotCompletedOutboxPayload`**（`src/rankings/ranking-snapshot-completed-outbox-payload.ts`）与 **`src/kafka/schemas/*.schema.json`** 固化。  
- `OutboxEvent.type` 另有 `clickhouse.ranking.snapshot.ingest`、`elasticsearch.entity.sync`、`elasticsearch.crawled_url.sync`、`ranking.followup.requested`（需 **`RANKING_FOLLOWUP_OUTBOX=true`** 且跑 **`ranking-followup`** 任务时才写入）等，由各自 **进程内 Flusher** 或占位逻辑消费，**不会**随 Kafka 发布；其中 ES 两行 **`payload`** 在 **`elastic-*-sync-outbox-payload.ts`**，**`OutboxEvent` 行** 仍由 **`elastic-*-outbox.ts`** 的 `*Create` 组装；其余 **`payload`** 由 **`buildClickhouseRankingSnapshotOutboxPayload`**、**`buildRankingFollowupRequestedOutboxPayload`** 等固化（总表见 **`src/outbox/outbox-admin.controller.ts`** 类注释）。  
- **运维排查**：`GET /admin/outbox?limit=50&pendingOnly=true&type=...` 只读列出积压行（无鉴权，勿暴露公网）。**接口契约**见源码 **`src/outbox/outbox-admin.controller.ts`** 类注释；**OpenAPI 3 片段**：**`docs/openapi/admin-outbox.yaml`**（可导入 Swagger UI）。管理台 Outbox 页提供 **五种主要 `type` 快捷按钮**（含 ES 两行、Kafka 排行、CH、**`ranking.followup.requested`**）、**清空 type**、**limit/type 框 Enter 加载**、**新标签打开与当前筛选一致的查询 URL**、**复制该 GET URL**（**无可复制文本时复制按钮禁用**；**limit 非法或非正按 40、超过 200 按 200**，与接口校验上限一致；**type 框 maxLength 120**，与 DTO `@MaxLength` 一致）；表格在存在对应行时展示 **Kafka / CH / ES 实体 / ES 爬取 / followup** 等 **`payload` 摘要列**，原始 JSON 区对契约键名 **浅色高亮**。  
- **OpenAPI 片段**：目录 **`docs/openapi/`**（另含 **`admin-entities.yaml`** → **`GET /admin/entities`**）；**`npm test`** 中 **`src/openapi/docs-openapi.spec.ts`** 会解析目录下全部 **`.yaml`** 并断言 **OpenAPI 3** 与 **`paths`** 非空。  
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

**分布式爬虫**：队列任务在 **Redis（BullMQ）**，多实例会自然抢同一 `crawl` 队列。可额外起 **仅消费进程**（无 HTTP）：先 `npm run build`，再 **`npm run start:crawl-worker`**（与 API 使用相同 `DATABASE_URL` / `REDIS_URL` / 抓取相关环境变量）。调整单机并发用 **`CRAWL_WORKER_CONCURRENCY`**；长耗时抓取可调 **`CRAWL_JOB_LOCK_MS`**（默认约「HTTP 超时 + 120s」）。

### 探活与就绪

- `GET /health`：进程存活（liveness）。  
- `GET /health/ready`：**PostgreSQL + Redis** 均可连；任一侧失败时 **HTTP 503**（readiness / 依赖检查）。管理台 **概览** 提供 **新标签探活直链**（`/health`、`/health/ready`、`/health/db` 等）及 **快速入口**。  
- 分项：`GET /health/db`、`GET /health/redis`、`GET /health/kafka`；搜索与 OLAP：`GET /v1/search/health`（管理台 **搜索** 页可新标签打开 JSON）、`GET /v1/analytics/clickhouse/health`（**概览** 快速入口亦提供新标签链）。

相对路径的字面量与 `web/src/lib/backend-api-paths.ts`（`/health`、`/admin`）、`web/src/lib/nest-api-paths.ts`（`/v1`）对齐；下述 `curl` 默认仍为 `http://localhost:3000` 便于本地复制。

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/health/ready
```

## Demo API

```bash
curl -s -X POST http://localhost:3000/admin/seed-demo -H 'Content-Type: application/json' -d '{}'
```

### 同步排行（小包络）

`POST /v1/rankings/run`，body 不含 `async` 或 `"async": false`。响应为快照对象（含 **`hasScoreModel`**、与 **`GET /v1/snapshots/:id`** 同类的嵌套 **`items`** 等）。管理台 **`/rankings/run`** 在成功物化快照时展示 **打开快照** 快捷链（覆盖：同步 JSON 的 `id`、异步 **completed** 的 `returnvalue.id`、**dedup** 的 `snapshotId`、以及 job **404** 后依 DB `status=completed` 从 `snapshots[0].id` 解析）。

### 异步排行（生产路径）

```bash
curl -s -X POST http://localhost:3000/v1/rankings/run \
  -H 'Content-Type: application/json' \
  -d '{"topicVersionId":"1","timeWindow":"WEEK","windowStart":"2026-05-10T00:00:00.000Z","windowEnd":"2026-05-17T00:00:00.000Z","asOf":"2026-05-20T12:00:00.000Z","async":true}'
# → { "jobId": "...", "topicRankingId": "..." }
# 同窗口已有快照未入队：`dedupedSnapshot: true`、`snapshotId`、`hasScoreModel`（可选）。

curl -s http://localhost:3000/v1/jobs/ranking/<jobId>
curl -s http://localhost:3000/v1/rankings/<topicRankingId>/status
# status：`snapshots[]` 含 `scoreModelId` 及 **`hasScoreModel`**（是否已关联物化 **`ScoreModel`**）；`topicRankingId` 非合法 BigInt 时为 **400**。
```

快照详情：`GET /v1/snapshots/{id}`（bigint 已转字符串；响应含 **`items[].scoreBreakdown`**、**`scoreModel`**（新物化快照）、嵌套 **`topicRanking`**）。**`GET /v1/snapshots/{id}/score-breakdowns`** 导出关系表 **`ScoreBreakdown`** 扁平行（审计/报表；旧快照可无行）。可选 **`?includeAiStats=1`** 合并当前 **`AiAnalysis`** 条数与 **`hasFollowupBrief`** / **`hasTrendBrief`** / **`hasCredibilityBrief`**（**本条响应不走快照 Redis 缓存**）。管理台 `/snapshots/:id` 支持 **`?analysisKind=`**（与 API **`agentKind`** 一致）、**`?analysisPage=`**（默认 1）、**`?analysisLimit=`**（默认 50，最大 200）与简报分页。快照详情与 **快照对比** 表中的实体名可点进 **`/search?q=`**；得分分布 **ECharts 柱图点击柱条** 亦可跳到同名聚合搜索；**复制 snapshot id**、**复制 topicVersionId**、**复制 topicRankingId**、**新标签打开** **`GET /v1/snapshots/:id`**、**`GET /v1/snapshots/:id/analyses`** 与 **`GET /v1/rankings/:id/status`**。

同一 **`TopicRanking`** 下多张快照并列对比：`POST /v1/snapshots/compare`，body 为 `{"snapshotIds":["1","2"]}`（**2–10** 个 id，可去重）；可选 **`"includeAiStats": true`**，响应 **`snapshots[]`** 每项合并 **`aiAnalysisCount`**、**`hasFollowupBrief`**、**`hasTrendBrief`**、**`hasCredibilityBrief`**（与快照详情 `?includeAiStats=1` 同源统计）、**`hasScoreModel`**；**`rows[].bySnapshot[snapshotId]`** 可含 **`scoreBreakdown`**（与条目 JSON 字段同源）。管理台 **`/snapshots/compare`**（支持 `?ids=` 与 **`?includeAiStats=1`** 预勾选；**无查询串时不预填示例 id**；**2–10 个十进制 id（≤38 位）才允许对比/复制 POST 与路径**；**对比成功后地址栏与 ids 对齐**；**复制 POST 体**、**复制对比页路径**；页脚链至 **运行排行 / 索引 / 爬虫 / Outbox** 等）。侧栏在 **`/snapshots/:id` 详情**时同步高亮 **「快照对比」** 以便返回同类操作。

```bash
curl -s -X POST http://localhost:3000/v1/snapshots/compare \
  -H 'Content-Type: application/json' \
  -d '{"snapshotIds":["1","2"]}'
curl -s -X POST http://localhost:3000/v1/snapshots/compare \
  -H 'Content-Type: application/json' \
  -d '{"snapshotIds":["1","2"],"includeAiStats":true}'
```

### 实体排行时间演化（历史快照点）

每次成功物化快照会写入 **`RankingItemHistory`**，并在 **`TrendAnalysis`** 表插入一条快照级摘要（`entityId` 为空，`payload.kind=snapshot_summary`，含 `trendTypeCounts`、`topRankGainers` / `topRankLosers` 等）。查询某实体在话题下的名次时间序列：

```bash
curl -s 'http://localhost:3000/v1/entities/1/rank-history?topicSlug=global-female-singers&timeWindow=WEEK&limit=50'
```

`timeWindow` 可选；`limit` 默认 100、最大 500（按时间倒序取最近若干点，响应内 `points` 已按时间升序）。`summary` 含该窗口内**历史最好/最差名次**，以及**末端连续上升 / 连续下降步数**（`endStreakRankImproving` / `endStreakRankDeclining`）。

按话题 slug 列出近期 **快照级** `TrendAnalysis`（默认 20 条，最大 100）：

```bash
curl -s 'http://localhost:3000/v1/topics/global-female-singers/trend-analyses?limit=15'
# 可选 &timeWindow=WEEK
```

按话题 slug 列出近期 **`TopicRankSnapshot`**（默认 30 条，最大 100，按 `snapshotTime` 倒序）；每条含 **`aiAnalysisCount`**、**`hasFollowupBrief`**、**`hasTrendBrief`**、**`hasCredibilityBrief`**（按约定 `agent` 或对应 **`detailJson.agentKind`** 判定）、**`hasScoreModel`**（新物化是否已关联 **`ScoreModel`**，便于区分能否期望 **`GET …/score-breakdowns`** 有行）。

```bash
curl -s 'http://localhost:3000/v1/topics/global-female-singers/snapshots?limit=25'
# 可选 &timeWindow=WEEK
```

跨话题只读「热点」：**聚合**近期快照级 `TrendAnalysis.payload.topRankGainers` 的涨名次（演示级，`limit` 默认 15、最大 50）：

```bash
curl -s 'http://localhost:3000/v1/trends/hot?limit=12'
# 可选 &timeWindow=WEEK
```

更新 **`TopicVersion.policyJson`**（`frozen=true` 时拒绝；body 须含 **`weights`**；可选 **`entityIds`**、`requiredSignalKeys`，服务端与物化路径一致）：

```bash
curl -s -X PATCH http://localhost:3000/v1/topic-versions/1/policy \
  -H 'Content-Type: application/json' \
  -d '{"policyJson":{"weights":{"streams":0.4,"mentions":0.3,"social":0.2,"news":0.1},"requiredSignalKeys":["streams","mentions"]}}'
```

### 热榜聚合（按 slug）

默认：该话题**最新 effectiveFrom** 的 `TopicVersion` + **最近完成的** `TopicRanking`（含快照）+ 该 ranking 下**最新 snapshotTime** 的快照。

可选查询串：`version`、`timeWindow`、`windowStart`（若带 `windowStart` 必须同时带 `timeWindow`）、**`includeAiStats=1`**（嵌套 `snapshot` 合并 `aiAnalysisCount` / `hasFollowupBrief` / `hasTrendBrief` / `hasCredibilityBrief`，与 `GET /v1/snapshots/:id?includeAiStats=1` 一致；热榜 Redis 键含该开关，避免与无统计体混读）。响应为 `{ resolved, snapshot }`，其中 **`resolved.hasScoreModel`** 标示当前嵌套快照是否已关联 **ScoreModel**，**`snapshot`** 与快照详情 API 同形。管理台 **话题版本** 页（**slug 留空时仍按演示默认 `global-female-singers` 请求**，避免 `/topics//versions`）；**slug / 热榜 version 输入分别 maxLength 160 / 64**；**`timeWindow` / `windowStart` 输入 maxLength 16 / 80**；URL 预填超长 query 时同步截断；**热榜请求前校验** `timeWindow` 须在 Prisma 枚举内；**`windowStart` 非空时校验 ISO**；在加载热榜后会展示解析表，并支持 URL 预填：`?slug=`、`?version=`、`?timeWindow=`、`?windowStart=`；**Enter** 可在 slug / 热榜参数框内快捷触发请求；表格中 **实体名可点进 `/search?q=`**，并可打开 **`/entities?q=`**；热榜预览区可 **复制 snapshotId / topicVersionId**；**新标签**打开与当前 slug、热榜参数一致的 **`GET /v1/topics/:slug/versions`** 与 **`/leaderboard`**。

```bash
curl -s 'http://localhost:3000/v1/topics/global-female-singers/leaderboard'
curl -s 'http://localhost:3000/v1/topics/global-female-singers/leaderboard?timeWindow=WEEK'
curl -s 'http://localhost:3000/v1/topics/global-female-singers/leaderboard?includeAiStats=1'
```

### 实体搜索（Elasticsearch + PG）

需 ES 运行且 `.env` 配置 `ELASTICSEARCH_NODE` 时，`/v1/search/entities` 默认走 ES 并返回 **`highlights`**（`<em>` 包裹命中词）。`GET /admin/entities` 列出实体（运营台与脚本）。管理台 **`/entities`** 支持 **`?q=`** 预填列表筛选框并刷新；**新标签打开与当前筛选一致的列表 API**（`limit=50` + 可选 `q`）；**排行 topicSlug** 输入框控制每行 **rank-history** JSON 与 **「曲线」**（**`/entities/rank-history`**，ECharts）。新建/编辑表单 **`canonicalName` 输入框 `maxLength=500`**、**`type` 为 120**，与 **POST/PATCH DTO** 一致。

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
# 同上：可选 body 如 {"agent":"trend-v1","chainContext":"…"}（≤8192，配 OPENAI_API_KEY 时写入 user 前缀）
curl -s 'http://localhost:3000/v1/snapshots/1?includeAiStats=1'
curl -s http://localhost:3000/v1/snapshots/1/analyses
# 响应体为 `{ filter, total, analyses }`；可选 ?agentKind= &agent= &limit=（默认 50，最大 200）&offset=
curl -s 'http://localhost:3000/v1/snapshots/1/analyses?agentKind=trend&limit=20&offset=0'
curl -s 'http://localhost:3000/v1/snapshots/1/score-breakdowns'
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
- 成功行写入 `mimeType`、**`pageTitle`**（HTML `<title>` 或 Playwright `document.title`，最长 512）、去标签后的 **`textPreview`**（仅文本类 MIME；长度见 `CRAWL_TEXT_PREVIEW_CHARS`），便于列表展示与检索（PG/ES 均支持按标题子串命中）。  
- `GET /v1/crawl/sources?limit=50` 列出 `Source`（id 降序，默认至多 50 条，最大 100）。  
- `GET /v1/crawl/sources/:sourceId/urls?limit=50` 查看最新 `CrawledUrl` 行（含摘要）。
- `GET /v1/crawl/tasks?limit=30` 列出近期 `CrawlTask`（`limit` 1–100，非数字或缺省按 30 再钳制）；可选 **`sourceId`** 只看待定数据源。

```bash
curl -s 'http://localhost:3000/v1/crawl/sources?limit=50'
curl -s 'http://localhost:3000/v1/crawl/tasks?limit=30'
curl -s 'http://localhost:3000/v1/crawl/tasks?limit=30&sourceId=1'
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
