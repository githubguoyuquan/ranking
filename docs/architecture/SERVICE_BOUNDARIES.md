# 服务边界与进程拆分

## 限界上下文（目标微服务）

| 上下文 | Nest 模块（当前单体） | 目标服务 |
|--------|----------------------|----------|
| BC_Topic | `RankingsModule`（话题/版本/policy） | `topic-service` |
| BC_Crawl | `IngestionModule` | `crawl-service` |
| BC_Rank | `RankingsModule`（物化/快照） | `ranking-service` |
| BC_Search | `SearchModule` | `search-service` |
| BC_AI | `AgentModule` + `AgentOrchestrationModule` | `ai-orchestration-service` |
| BC_Time | `AnalyticsModule` | `analytics-service` |
| BC_Admin | 各 `admin/*` Controller | 留在 API 或 BFF |

## Phase 1（已实现）：同镜像、多进程

| 进程 | 入口 | `PROCESS_ROLE` | 职责 |
|------|------|----------------|------|
| API | `dist/main.js` | `api` | HTTP、`/v1/*`、管理台 BFF |
| Platform Worker | `dist/platform-worker.main.js` | `worker` | BullMQ 排行/follow-up/ai-agent、**Outbox→Kafka（仅 Producer）**、CH/ES **Flusher（非 Kafka Consumer）** |
| Crawl Worker | `dist/crawl-worker.main.js` | `crawl` | BullMQ `crawl` 队列 |

本地开发默认 `PROCESS_ROLE=all`（未设置时），单进程跑全部 Worker。

Helm：`deploy/helm/ranking/` 下 `api` / `platformWorker` / `crawlWorker` 三个 Deployment。

进程与限界上下文目录：`src/config/service-manifest.ts`；`GET /admin/scale/status` → `serviceManifest`。

## Phase 2（规划）：按上下文拆仓库

1. 抽出 **Search**（ES/Embedding/推荐）— Outbox `elasticsearch.*` 与 Flusher 同边界。  
2. 抽出 **Rank** — 物化与快照 API；Kafka `ranking.*` 主题。  
3. **Crawl** 独立扩缩；`crawl.url.fetched` 已是跨服务契约。  

**MVP 下游**：`consumers/snapshot-notify/` 消费 `ranking.snapshot.completed`（见 `CONSUMER_BOUNDARY.md`）。

## 事件契约

- **跨服务**：Outbox → **Kafka**（本仓库只发布；消费方在外部部署）→ 见 `docs/kafka/CONSUMER_BOUNDARY.md`  
- **同进程异步**：BullMQ（`ranking`、`crawl`、`ai-agent`）或 Outbox **Flusher**（ES/CH）  
- **同步读**：REST `/v1/*`  

详见 `docs/kafka/EVENT_CATALOG.md`。
