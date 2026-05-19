# 规模验证（托管 ES ILM · Qdrant 压测 · CH MV · BI 钻取）

## 一键套件

```bash
# 需 API 运行且配置 admin API Key
export API_KEY=your-admin-key
npm run scale:validate
```

等价于 `POST /admin/scale/validate`（并行：ES ping/ILM/stats/benchmark、Qdrant benchmark、CH MV 健康）。

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

- `/scale` — ILM、压测、validate 按钮
- `/bi` — 钻取侧栏
