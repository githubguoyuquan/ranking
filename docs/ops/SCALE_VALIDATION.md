# 规模验证（托管 ES ILM · Qdrant 压测 · CH MV · BI 钻取）

## 一键套件

```bash
# 需 API 运行且配置 admin API Key
export API_KEY=your-admin-key
npm run scale:validate
```

等价于 `POST /admin/scale/validate`（并行：ES ping/ILM/stats/benchmark、Qdrant benchmark、CH MV 健康）。

响应含 **`status`**（`ok` | `warn` | `critical`）与 **`checks[]`** SLO 明细。脚本退出码：`0`=ok、`1`=warn、`2`=critical。

### SLO 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `SCALE_VALIDATE_ES_P95_MS` | 500 | ES 实体检索 p95 上限（ms） |
| `SCALE_VALIDATE_QDRANT_P95_MS` | 300 | Qdrant lexical/vector p95 上限 |
| `SCALE_VALIDATE_REQUIRE_ES` | wiring 时 true | 未配置 ES 时 critical |
| `SCALE_VALIDATE_REQUIRE_CH` | wiring 时 true | 未配置 CH 时 critical |
| `SCALE_VALIDATE_REQUIRE_QDRANT` | wiring 时 true | 未配置 Qdrant 时 critical |
| `SCALE_VALIDATE_MIN_STATUS` | ok | 脚本 `--min-status=warn` 仅 fail critical |

### 常态化调度

- **K8s**：`scaleValidateCron.enabled=true`（见 `values-aws-production.yaml`）
- **GHA**：`.github/workflows/scale-validate-scheduled.yml`（`RANKING_SCALE_VALIDATE_ENABLED=true`）
- 失败告警：`DR_ALERT_ON_FAILURE=true` + `ALERT_WEBHOOK_URL`

## 托管 Elasticsearch + ILM

### 环境变量

| 变量 | 说明 |
|------|------|
| `ELASTICSEARCH_NODE` | 集群 URL（托管或自管） |
| `ELASTICSEARCH_USE_WRITE_ALIAS=true` | 写别名模式 |
| `ELASTICSEARCH_ILM_ENABLED=true` | 模板绑定 ILM + 专用 bootstrap |
| `ELASTICSEARCH_ROLLOVER_MAX_DOCS` / `MAX_AGE` | 热阶段 rollover |
| `ELASTICSEARCH_ILM_DELETE_AFTER_DAYS` | 可选删除阶段（天） |

### 推荐顺序（新集群）

```bash
curl -s -X POST -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/scale/elasticsearch/ensure-ilm

curl -s -X POST -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/scale/elasticsearch/ensure-templates

curl -s -X POST -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/scale/elasticsearch/bootstrap-ilm-indices

curl -s -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/scale/elasticsearch/ilm-status | jq .
```

策略实现：`src/search/elastic-ilm.config.ts`；参考 JSON：`deploy/elasticsearch/ilm-policy.example.json`。

手动 rollover：`POST /admin/scale/elasticsearch/rollover-entities`。

### ES 检索压测

```bash
curl -s -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"rank","iterations":30}' \
  http://localhost:3000/admin/scale/elasticsearch/benchmark | jq .
```

返回 `latencyMs.p50/p95` 与 `hitsPerQuery`。

## Qdrant 压测

```bash
curl -s -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"rank","iterations":50,"limit":10}' \
  http://localhost:3000/admin/scale/qdrant/benchmark | jq .
```

- **lexical**：payload `searchText` 过滤 scroll
- **vector**：随机单位向量 kNN
- 指标：`latencyMs`、`qps`

前置：数据已 `POST /admin/reindex-entities`；`QDRANT_URL` 已配置。

## ClickHouse MV

初始化 SQL：`clickhouse/docker-entrypoint-initdb.d/003_bi_daily_rollups.sql`

- 表 `metric_daily_topic`
- MV `mv_metric_daily_topic` ← `metric_timeseries`

健康检查：

```bash
curl -s -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/bi/clickhouse/mv-health | jq .
```

写入路径：`SYNC_RANKING_TO_CLICKHOUSE=true` 快照 ingest → `metric_timeseries` → MV 自动 rollup。

## BI 钻取

| API | 用途 |
|-----|------|
| `GET /admin/bi/drill/entity/:entityId?days=30` | 实体榜位 CH 火花线 + PG 元数据 |
| `GET /admin/bi/drill/topic/:topicId?days=14` | 话题 MV 日聚合 |
| `GET /admin/bi/overview` | 含 `charts.clickhouseMv`、话题 slug  enriched |

前端：`/bi` 大屏 — 涨榜列表与 CH 话题 chip 打开右侧钻取面板。

## 运维 UI

- `/scale` — ILM、压测、validate、PG 分区、CH 冷热分层、ES CCR 按钮
- `/bi` — 钻取侧栏

## PostgreSQL 月分区

父表 DDL 示例：`prisma/migrations/optional_partition_parent.sql`（维护窗口执行）。

```bash
curl -s -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"monthsAhead":4}' \
  http://localhost:3000/admin/scale/postgres/ensure-partitions | jq .
```

- 省略 `table` 时同时 ensure `RankingItemHistory` + `CrawledUrl`
- Platform Worker 内置 Cron（`POSTGRES_PARTITION_CRON_DISABLED=true` 可关）
- K8s：`postgresPartitionCron.enabled=true`（Helm CronJob 调用 `scripts/postgres-ensure-partitions.sh`）

## ClickHouse 热/冷分层

| 变量 | 说明 |
|------|------|
| `CLICKHOUSE_HOT_TTL_DAYS` | 热层 TTL（默认 90） |
| `CLICKHOUSE_COLD_TTL_DAYS` | 冷层后删除（需 `CLICKHOUSE_COLD_VOLUME`） |
| `CLICKHOUSE_COLD_VOLUME` | CH volume 名（如 `cold`；见 `004_cold_tier_storage.sql`） |

```bash
curl -s -X POST -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/scale/clickhouse/ensure-tier | jq .

curl -s -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/scale/clickhouse/tier-status | jq .
```

## Elasticsearch 跨集群 DR（CCR）

| 变量 | 说明 |
|------|------|
| `ELASTICSEARCH_CCR_REMOTE_CLUSTER` | Leader 集群注册名 |
| `ELASTICSEARCH_CCR_LEADER_PATTERN` | 可选 leader index pattern |
| `ELASTICSEARCH_CCR_AUTO_FOLLOW` | `true` 时 `POST bootstrap-ccr` 写入 auto-follow |

```bash
curl -s -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/scale/elasticsearch/ccr-status | jq .

curl -s -X POST -H "X-API-Key: $API_KEY" \
  http://localhost:3000/admin/scale/elasticsearch/bootstrap-ccr | jq .
```

DR readiness 含 `postgres_partitions`、`clickhouse_tier`、`elasticsearch_ccr` 检查项。
