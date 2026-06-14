# 告警值班手册（On-call Runbook）

Outbox 积压、爬虫调度异常、趋势异常三类告警经 **`AlertWebhookRouterService`** 统一外发 Webhook（Envelope v1）。本手册供值班 triage 与升级。

## 快速探测

```bash
# 聚合 Outbox + 爬虫告警
RANKING_API_KEY=rk_… npm run alert:summary

# 仅 DR（独立通道，见 DR_RUNBOOK.md）
npm run dr:readiness
```

| API | 说明 |
|-----|------|
| `GET /admin/observability/summary` | Outbox + 爬虫 + `alerts[]` |
| `GET /admin/trends/alerts` | 趋势异常扫描 |

OpenAPI：`docs/openapi/trends.yaml`、`admin-observability.yaml`。
| `GET /admin/observability/alerts/routing` | Webhook 路由（URL 脱敏） |
| `GET /admin/observability/alerts/runbook` | 告警代码 triage JSON |
| `GET /admin/bi/overview` | BI 大屏（`observability` + `trends`） |

## Webhook 配置

| 变量 | 说明 |
|------|------|
| `ALERT_WEBHOOK_URL` | **主入口**（推荐）；兼容 `OBSERVABILITY_ALERT_WEBHOOK_URL` |
| `ALERT_WEBHOOK_ROUTES` | JSON 路由，见下 |
| `ALERT_WEBHOOK_BEARER_TOKEN` | 可选 Bearer |
| `ALERT_WEBHOOK_FORMAT` | `json`（默认）、`slack` 或 `pagerduty` |
| `PAGERDUTY_ROUTING_KEY` | PagerDuty Events API v2 routing key（`critical` 路由到 `events.pagerduty.com` 时） |
| `DR_ALERT_ON_FAILURE` | `true` 时 DR/scale 探测脚本失败会 POST 告警 |
| `ALERT_WEBHOOK_COOLDOWN_SECONDS` | 同 code 冷却（默认 300s，防刷屏） |
| `ALERT_WEBHOOK_DISABLED` | `true` 关闭全部外发 |
| `TREND_ANOMALY_ALERT_WEBHOOK_URL` | 趋势专用覆盖（无 `categories.trends` 时生效） |

`ALERT_WEBHOOK_ROUTES` 示例：

```json
{
  "default": "https://hooks.slack.com/services/…/ops",
  "critical": "https://events.pagerduty.com/integration/…/enqueue",
  "categories": {
    "trends": "https://hooks.slack.com/services/…/trends"
  }
}
```

路由优先级：`categories[category]` → 趋势 legacy URL → `critical`（仅当本批含 critical）→ `default` / `ALERT_WEBHOOK_URL`。

### Envelope v1 载荷

```json
{
  "envelopeVersion": 1,
  "source": "ranking-platform-ops",
  "category": "ops",
  "generatedAt": "2026-06-12T…",
  "status": "critical",
  "environment": { "drRegion": "ap-southeast-1", "processRole": "worker" },
  "alertCount": 2,
  "alerts": [
    {
      "code": "outbox_kafka_pending_critical",
      "severity": "critical",
      "category": "outbox",
      "message": "…",
      "runbookAnchor": "#outbox_kafka_pending_critical"
    }
  ],
  "context": { "outbox": { … }, "crawl": { … } }
}
```

Cron 来源：

| Cron | 间隔 | 进程 | `source` |
|------|------|------|----------|
| `ObservabilityAlertCronService` | 2 min | Platform Worker | `ranking-platform-ops` |
| `TrendAnomalyAlertCronService` | 10 min | Ranking Worker | `ranking-platform-trends` |

关闭 Cron：`OBSERVABILITY_ALERT_CRON_DISABLED=true` / `TREND_ANOMALY_ALERT_CRON_DISABLED=true`。

## 严重级别与升级

| 级别 | 响应目标 | 升级 |
|------|----------|------|
| **warn** | 30 min 内确认 | 持续 2 个评估周期未恢复 → 当班 TL |
| **critical** | 15 min 内 ack | 30 min 未缓解 → 升级 on-call secondary + 产品负责人 |

升级前收集：`/admin/observability/summary` JSON、`kubectl logs` Platform Worker、最近 deploy 时间。

---

## Outbox 告警

| Code | 含义 | 首要动作 |
|------|------|----------|
| `outbox_flusher_pending_*` | ES/CH 等 Flusher 积压 | 查 Worker 存活、ES/CH 健康 |
| `outbox_flusher_lag_*` | 最旧未刷行过老 | 查 poison message（高 attempts） |
| `outbox_kafka_pending_*` | Kafka 未外发 | 查 MSK、Schema Registry、Worker |
| `outbox_kafka_lag_*` | 最旧 Kafka 行过老 | `GET /admin/ops/dr/outbox-replay-plan` |
| `outbox_high_attempts` | 重试过多 | 抽样 Outbox 表 fix/skip |
| `outbox_last_error` | 存在 lastError | 读错误文本分类 transient/permanent |

**Playbook**

1. `GET /admin/observability/outbox` — pending 按 type。
2. Grafana **Ranking Ops** — `ranking_outbox_*`。
3. Flusher 依赖挂掉 → 恢复依赖，积压自消化。
4. Kafka DR → [DR_RUNBOOK.md](./DR_RUNBOOK.md) Outbox 重放节。

阈值 env：见 [OBSERVABILITY.md](./OBSERVABILITY.md)。

---

## 爬虫告警

| Code | 含义 | 首要动作 |
|------|------|----------|
| `crawl_scheduler_stale` | 无近期 `CrawlScheduleRun` | 确认 scheduler 未 `CRAWL_SCHEDULER_DISABLED` |
| `crawl_schedule_failed_1h` | 1h 调度失败过多 | `GET /admin/crawl/overview` 看 failed runs |

**Playbook**

1. `GET /admin/crawl/overview` — scheduler SLA、`recentRuns`。
2. Crawl Worker：`kubectl get pods -l app.kubernetes.io/component=crawl-worker`。
3. Redis / BullMQ 队列 `crawl` 或分片 `crawl:region` 深度。
4. 区域分片：核对 `CRAWL_QUEUE_SHARD` 与 Helm `crawlWorkerRegions`。

---

## 趋势异常告警

| Code | 含义 | 首要动作 |
|------|------|----------|
| `entity_rank_surge` / `entity_rank_plunge` | 单次名次跳变 | 核对 snapshot / 数据源 |
| `snapshot_surge_cluster` | SURGE 过多 | 话题级数据质量 |
| `snapshot_volatile_cluster` | VOLATILE 占比高 | 打分/decay 配置 |
| `snapshot_momentum_imbalance` | 涨跌严重失衡 | 信源是否单边故障 |
| `entity_streak_*` | 连续升降 streak | 通常运营关注，非 P0 |

**Playbook**

1. `GET /admin/trends/alerts` 或 `GET /v1/trends/anomalies`。
2. BI `/bi` → `trends.alerts`。
3. 阈值：`TREND_ANOMALY_*`（`.env.example`）。
4. 误报 → 调高阈值；真异常 → 通知运营，无需重启服务。

---

## Helm / 生产

`deploy/helm/ranking/values.yaml` → `alerts.webhookUrl` / `alerts.webhookRoutes` 注入 Platform Worker。敏感 token 放 External Secrets（键 `ALERT_WEBHOOK_BEARER_TOKEN`）。

AWS 叠加示例见 `values-aws-production.yaml` 注释。

## 相关文档

- [OBSERVABILITY.md](./OBSERVABILITY.md) — 指标与 Cron
- [DR_RUNBOOK.md](./DR_RUNBOOK.md) — 灾备与 Outbox 重放
- [PRODUCTION.md](./PRODUCTION.md) — 拓扑
