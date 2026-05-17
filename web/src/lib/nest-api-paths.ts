/**
 * Nest `/v1/*` 相对路径（不含 origin）。与 `nest-api-urls` 及后端路由保持一一对应。
 * 页面文案里展示 API 路径时可 import 本模块，避免与绝对 URL 逻辑脱节。
 */
const V1 = "/v1";

export const NEST_V1 = {
  search: `${V1}/search`,
  searchEntities: `${V1}/search/entities`,
  searchCrawledUrls: `${V1}/search/crawled-urls`,
  searchCrawledUrlsEs: `${V1}/search/crawled-urls-es`,
  searchHealth: `${V1}/search/health`,
  clickhouseHealth: `${V1}/analytics/clickhouse/health`,
  rankingsRun: `${V1}/rankings/run`,
  snapshotsCompare: `${V1}/snapshots/compare`,
  crawlSources: `${V1}/crawl/sources`,
  crawlTasks: `${V1}/crawl/tasks`,
  crawlUrls: `${V1}/crawl/urls`,
} as const;

export function nestV1RankingStatusPath(topicRankingId: string): string {
  return `${V1}/rankings/${encodeURIComponent(topicRankingId)}/status`;
}

export function nestV1RankingJobPath(jobId: string): string {
  return `${V1}/jobs/ranking/${encodeURIComponent(jobId)}`;
}

export function nestV1SnapshotPath(snapshotId: string): string {
  return `${V1}/snapshots/${encodeURIComponent(snapshotId)}`;
}

export function nestV1SnapshotAnalysesPath(snapshotId: string): string {
  return `${V1}/snapshots/${encodeURIComponent(snapshotId)}/analyses`;
}

export function nestV1TopicVersionsPath(topicSlug: string): string {
  return `${V1}/topics/${encodeURIComponent(topicSlug)}/versions`;
}

export function nestV1TopicLeaderboardPath(
  topicSlug: string,
  query?: URLSearchParams,
): string {
  const base = `${V1}/topics/${encodeURIComponent(topicSlug)}/leaderboard`;
  const qs = query?.toString() ?? "";
  return qs ? `${base}?${qs}` : base;
}

export function nestV1CrawlSourcesListPath(limit: number): string {
  return `${NEST_V1.crawlSources}?limit=${encodeURIComponent(String(limit))}`;
}

export function nestV1CrawlSourceUrlsPath(
  sourceId: string,
  limit: number,
): string {
  return `${V1}/crawl/sources/${encodeURIComponent(sourceId)}/urls?limit=${encodeURIComponent(String(limit))}`;
}

export function nestV1CrawlTaskPath(taskId: string): string {
  return `${V1}/crawl/tasks/${encodeURIComponent(taskId)}`;
}

export function nestV1CrawlCheckpointPath(crawlerName: string): string {
  return `${V1}/crawl/checkpoints/${encodeURIComponent(crawlerName)}`;
}

/** `'path' + 可选 ?query`（不含 origin）。 */
export function nestV1PathWithQuery(
  path: string,
  params: URLSearchParams,
): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * 文档/界面展示用（含 `:param` 占位），**勿**用于实际 HTTP path。
 */
export const NEST_V1_DOC = {
  topicsVersions: "/v1/topics/:slug/versions",
  topicsLeaderboard: "/v1/topics/:slug/leaderboard",
  rankingsStatus: "/v1/rankings/:topicRankingId/status",
  jobRanking: "/v1/jobs/ranking/:jobId",
  crawlTask: "/v1/crawl/tasks/:id",
  crawlSourceUrls: "/v1/crawl/sources/:sourceId/urls",
  crawlCheckpoint: "/v1/crawl/checkpoints/:crawlerName",
} as const;
