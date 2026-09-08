import { apiUrl } from "@/lib/api";
import {
  BACKEND_ADMIN,
  BACKEND_HEALTH,
  backendAdminBiDrillEntityPath,
  backendAdminBiDrillTopicPath,
  backendAdminEntitiesPath,
  backendAdminEntityByIdPath,
  backendAdminEntityMetricsPath,
  backendAdminOutboxPath,
  backendAdminSnapshotAnalyzePath,
  backendAdminTopicVersionsPath,
  backendTopicEntitiesPath,
  backendAdminTopicEntitiesRetryPath,
} from "@/lib/backend-api-paths";

export function backendAbs(path: string): string {
  return apiUrl(path);
}

export function backendHealthUrl(): string {
  return backendAbs(BACKEND_HEALTH.root);
}

export function backendHealthReadyUrl(): string {
  return backendAbs(BACKEND_HEALTH.ready);
}

export function backendHealthDbUrl(): string {
  return backendAbs(BACKEND_HEALTH.db);
}

export function backendHealthRedisUrl(): string {
  return backendAbs(BACKEND_HEALTH.redis);
}

export function backendHealthKafkaUrl(): string {
  return backendAbs(BACKEND_HEALTH.kafka);
}

export function adminBiOverviewUrl(): string {
  return backendAbs(BACKEND_ADMIN.biOverview);
}

export function adminReindexEntitiesUrl(): string {
  return backendAbs(BACKEND_ADMIN.reindexEntities);
}

export function adminReindexCrawlDocsUrl(): string {
  return backendAbs(BACKEND_ADMIN.reindexCrawlDocs);
}

export function adminSeedDemoUrl(): string {
  return backendAbs(BACKEND_ADMIN.seedDemo);
}

export function adminTopicsUrl(): string {
  return backendAbs(BACKEND_ADMIN.topics);
}

export function adminTopicVersionsUrl(topicSlug: string): string {
  return backendAbs(backendAdminTopicVersionsPath(topicSlug));
}

export function topicEntitiesUrl(topicSlug: string): string {
  return backendAbs(backendTopicEntitiesPath(topicSlug));
}

export function adminTopicEntitiesRetryUrl(topicSlug: string): string {
  return backendAbs(backendAdminTopicEntitiesRetryPath(topicSlug));
}

export function adminSnapshotAnalyzeUrl(snapshotId: string): string {
  return backendAbs(backendAdminSnapshotAnalyzePath(snapshotId));
}

export function adminOutboxUrl(params: URLSearchParams): string {
  return backendAbs(backendAdminOutboxPath(params));
}

export function adminEntitiesUrl(params?: URLSearchParams): string {
  return backendAbs(backendAdminEntitiesPath(params));
}

export function adminEntityByIdUrl(entityId: string): string {
  return backendAbs(backendAdminEntityByIdPath(entityId));
}

export function adminEntityMetricsUrl(entityId: string): string {
  return backendAbs(backendAdminEntityMetricsPath(entityId));
}

export function adminBiDrillEntityUrl(entityId: string, days = 30): string {
  return backendAbs(backendAdminBiDrillEntityPath(entityId, days));
}

export function adminBiDrillTopicUrl(topicId: string, days = 14): string {
  return backendAbs(backendAdminBiDrillTopicPath(topicId, days));
}

export function adminCrawlOverviewUrl(): string {
  return backendAbs(BACKEND_ADMIN.crawlOverview);
}
