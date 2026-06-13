# 生产可观测（Outbox / 爬虫 / BI / Grafana）

## API（需 `admin` API Key）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/observability/summary` | Outbox lag + 爬虫 + **alerts[]** |
| GET | `/admin/observability/prometheus` | Prometheus text（Grafana 抓取） |
| GET | `/admin/observability/outbox` | 仅 Outbox |
| GET | `/admin/observability/crawl` | 仅爬虫调度 |
| GET | `/admin/bi/overview` | BI 大屏（内嵌 `observability`） |

OpenAPI 片段：`docs/openapi/admin-observability.yaml`、`admin-bi.yaml`、`admin-crawl-scheduler.yaml`。

## Outbox lag 指标

| 轨道 | 字段 | 含义 |
|------|------|------|
| Flusher | `publishedAt IS NULL` | ES/CH 等侧效应未刷完 |
| Kafka | `kafkaPublishedAt IS NULL` 且 Kafka 路由 type | 未外发消息 |
| 双轨 | `publishedAt` 已填、`kafkaPublishedAt` 仍空 | Flusher 已完、Kafka 积压 |

## 告警阈值（环境变量）

| 变量 | 默认 | 说明 |
|------|------|------|
| `OUTBOX_PENDING_WARN` | 100 | Flusher 积压行数 warn |
| `OUTBOX_PENDING_CRITICAL` | 1000 | critical |
| `OUTBOX_LAG_WARN_SECONDS` | 300 | 最旧未刷行年龄 warn |
| `OUTBOX_LAG_CRITICAL_SECONDS` | 1800 | critical |
| `OUTBOX_KAFKA_PENDING_WARN` | 50 | Kafka 未发 warn |
| `OUTBOX_KAFKA_LAG_WARN_SECONDS` | 300 | 最旧未发 Kafka warn |
| `CRAWL_SCHEDULER_STALE_MINUTES` | 10 | 无近期 `CrawlScheduleRun` |
| `CRAWL_FAILED_RUNS_1H_WARN` | 10 | 1h 内调度失败次数 |

## 后台告警 Cron

- **Platform Worker**（`PROCESS_ROLE=worker|all`）每 2 分钟评估 Outbox + 爬虫，打 `WARN`/`ERROR` 日志
- **Ranking Worker** 每 10 分钟评估趋势异常（`TrendAnomalyAlertCronService`）
- 统一 Webhook：`AlertWebhookRouterService` → `ALERT_WEBHOOK_URL`（见 [ALERT_ONCALL_RUNBOOK.md](./ALERT_ONCALL_RUNBOOK.md)）
- 关闭：`OBSERVABILITY_ALERT_CRON_DISABLED=true` / `TREND_ANOMALY_ALERT_CRON_DISABLED=true`

## 告警 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/observability/alerts/routing` | Webhook 路由配置（脱敏） |
| GET | `/admin/observability/alerts/runbook` | 告警 code → triage 元数据 |
| GET | `/admin/trends/alerts` | 趋势异常扫描 |

值班脚本：`npm run alert:summary`（`scripts/alert-summary.sh`）。

## 本地 Grafana

```bash
# API 需运行且可访问（默认 :3000）；开发环境若开启 API Key，Prometheus 需能带 X-API-Key（见 prometheus.yml 注释）
docker compose up -d prometheus grafana
open http://localhost:3002   # admin / admin
```

Prometheus → `http://localhost:9090`  
预置看板：**Ranking Ops**（Outbox pending、Kafka、爬虫任务）

生产：将 `prometheus.yml` 的 `targets` 改为 K8s Service，并用 Secret 注入 `X-API-Key` 或内网免鉴权抓取。

## BI 大屏

`/bi` 顶部展示 **observability.alerts**（非 ok 项）；KPI 仍含 Outbox 待发布总数。
