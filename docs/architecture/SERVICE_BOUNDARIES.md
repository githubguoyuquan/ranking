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
| Platform Worker | `dist/platform-worker.main.js` | `worker` | BullMQ 排行/follow-up/ai-agent、Outbox→Kafka、CH/ES Flusher |
| Crawl Worker | `dist/crawl-worker.main.js` | `crawl` | BullMQ `crawl` 队列 |

本地开发默认 `PROCESS_ROLE=all`（未设置时），单进程跑全部 Worker。

Helm：`deploy/helm/ranking/` 下 `api` / `platformWorker` / `crawlWorker` 三个 Deployment。

## Phase 2（规划）：按上下文拆仓库

1. 抽出 **Search**（ES/Embedding/推荐）— Outbox `elasticsearch.*` 与 Flusher 同边界。  
2. 抽出 **Rank** — 物化与快照 API；Kafka `ranking.*` 主题。  
3. **Crawl** 独立扩缩；`crawl.url.fetched` 已是跨服务契约。  

## 事件契约

跨进程/跨服务仅通过 **Outbox + Kafka** 或 **REST**；见 `docs/kafka/EVENT_CATALOG.md`。
