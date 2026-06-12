/**
 * 运维探测与 BFF `/admin/*` 相对路径（不含 origin）。与 `backend-api-urls` 一致；
 * 界面展示可复制这里的常量，避免与绝对 URL 拆字不同步。
 */
export const BACKEND_HEALTH = {
  root: "/health",
  ready: "/health/ready",
  db: "/health/db",
  redis: "/health/redis",
  kafka: "/health/kafka",
} as const;

export const BACKEND_ADMIN = {
  reindexEntities: "/admin/reindex-entities",
  reindexCrawlDocs: "/admin/reindex-crawl-docs",
  seedDemo: "/admin/seed-demo",
  outbox: "/admin/outbox",
  entities: "/admin/entities",
  biOverview: "/admin/bi/overview",
  biDrillEntity: "/admin/bi/drill/entity",
  biDrillTopic: "/admin/bi/drill/topic",
  biClickhouseMvHealth: "/admin/bi/clickhouse/mv-health",
  scaleValidate: "/admin/scale/validate",
  agentsOverview: "/admin/agents/overview",
  agentsRuns: "/admin/agents/runs",
  agentsProposals: "/admin/agents/proposals",
  crawlOverview: "/admin/crawl/overview",
} as const;

export function backendAdminSnapshotAnalyzePath(snapshotId: string): string {
  return `/admin/snapshots/${encodeURIComponent(snapshotId)}/analyze`;
}

export function backendAdminOutboxPath(params: URLSearchParams): string {
  const qs = params.toString();
  return qs
    ? `${BACKEND_ADMIN.outbox}?${qs}`
    : BACKEND_ADMIN.outbox;
}

export function backendAdminEntitiesPath(params?: URLSearchParams): string {
  const qs = params?.toString() ?? "";
  return qs
    ? `${BACKEND_ADMIN.entities}?${qs}`
    : BACKEND_ADMIN.entities;
}

export function backendAdminEntityByIdPath(entityId: string): string {
  return `${BACKEND_ADMIN.entities}/${encodeURIComponent(entityId)}`;
}

export function backendAdminBiDrillEntityPath(entityId: string, days = 30): string {
  return `${BACKEND_ADMIN.biDrillEntity}/${encodeURIComponent(entityId)}?days=${days}`;
}

export function backendAdminBiDrillTopicPath(topicId: string, days = 14): string {
  return `${BACKEND_ADMIN.biDrillTopic}/${encodeURIComponent(topicId)}?days=${days}`;
}

/** 文档 / 界面展示用（含 `:id` 占位），勿用于实际请求 path。 */
export const BACKEND_ADMIN_DOC = {
  entitiesId: "/admin/entities/:id",
  snapshotAnalyze: "/admin/snapshots/:id/analyze",
} as const;

/** 展示用通配说明 */
export const BACKEND_DOC = {
  reindexPrefix: "/admin/reindex-*",
} as const;
