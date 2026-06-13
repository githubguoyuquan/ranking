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
  crawlSourceById: `${V1}/crawl/sources/:sourceId`,
  crawlTasks: `${V1}/crawl/tasks`,
  crawlUrls: `${V1}/crawl/urls`,
} as const;

export function nestV1RankingStatusPath(topicRankingId: string): string {
  return `${V1}/rankings/${encodeURIComponent(topicRankingId)}/status`;
}

export function nestV1RankingJobPath(jobId: string): string {
  return `${V1}/jobs/ranking/${encodeURIComponent(jobId)}`;
}

export function nestV1SnapshotPath(snapshotId: string, query?: URLSearchParams): string {
  const path = `${V1}/snapshots/${encodeURIComponent(snapshotId)}`;
  if (!query || query.toString() === "") return path;
  return nestV1PathWithQuery(path, query);
}

export function nestV1SnapshotAnalysesPath(
  snapshotId: string,
  query?: URLSearchParams,
): string {
  const path = `${V1}/snapshots/${encodeURIComponent(snapshotId)}/analyses`;
  if (!query || query.toString() === "") return path;
  return nestV1PathWithQuery(path, query);
}

export function nestV1SnapshotScoreBreakdownsPath(snapshotId: string): string {
  return `${V1}/snapshots/${encodeURIComponent(snapshotId)}/score-breakdowns`;
}

export function nestV1TopicPath(topicSlug: string): string {
  return `${V1}/topics/${encodeURIComponent(topicSlug)}`;
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

export function nestV1TopicTrendAnalysesPath(
  topicSlug: string,
  query?: URLSearchParams,
): string {
  const base = `${V1}/topics/${encodeURIComponent(topicSlug)}/trend-analyses`;
  const qs = query?.toString() ?? "";
  return qs ? `${base}?${qs}` : base;
}

export function nestV1TopicSnapshotsPath(
  topicSlug: string,
  query?: URLSearchParams,
): string {
  const base = `${V1}/topics/${encodeURIComponent(topicSlug)}/snapshots`;
  const qs = query?.toString() ?? "";
  return qs ? `${base}?${qs}` : base;
}

export function nestV1EntityRankHistoryPath(
  entityId: string,
  query: URLSearchParams,
): string {
  const base = `${V1}/entities/${encodeURIComponent(entityId)}/rank-history`;
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}

export function nestV1EntityTimelinePath(
  entityId: string,
  query?: URLSearchParams,
): string {
  const base = `${V1}/entities/${encodeURIComponent(entityId)}/timeline`;
  if (!query || query.toString() === "") return base;
  return nestV1PathWithQuery(base, query);
}

export const NEST_V1_TOPIC_VERSIONS_COMPARE = `${V1}/topic-versions/compare` as const;

export function nestV1TopicVersionPolicyPath(topicVersionId: string): string {
  return `${V1}/topic-versions/${encodeURIComponent(topicVersionId)}/policy`;
}

export function nestV1TrendsHotPath(query?: URLSearchParams): string {
  const base = `${V1}/trends/hot`;
  const qs = query?.toString() ?? "";
  return qs ? `${base}?${qs}` : base;
}

export function nestV1HotBoardsPath(query?: URLSearchParams): string {
  const base = `${V1}/hot-boards`;
  if (!query || query.toString() === "") return base;
  return nestV1PathWithQuery(base, query);
}

export function nestV1TrendsAnomaliesPath(query?: URLSearchParams): string {
  const base = `${V1}/trends/anomalies`;
  const qs = query?.toString() ?? "";
  return qs ? `${base}?${qs}` : base;
}

export function nestV1CrawlSourcePath(sourceId: string): string {
  return `${V1}/crawl/sources/${encodeURIComponent(sourceId)}`;
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

/** GET 列表；可选 `sourceId` 按数据源筛选 */
export function nestV1CrawlTasksListPath(limit: number, sourceId?: string): string {
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  if (sourceId !== undefined && sourceId !== '') {
    q.set('sourceId', sourceId);
  }
  return nestV1PathWithQuery(`${V1}/crawl/tasks`, q);
}

export function nestV1CrawlCheckpointPath(crawlerName: string): string {
  return `${V1}/crawl/checkpoints/${encodeURIComponent(crawlerName)}`;
}

export function nestV1EntityMetricsPath(
  entityId: string,
  query?: URLSearchParams,
): string {
  const path = `${V1}/entities/${encodeURIComponent(entityId)}/metrics`;
  if (!query || query.toString() === "") return path;
  return nestV1PathWithQuery(path, query);
}

export function nestV1TopicVersionSignalPreviewPath(
  topicVersionId: string,
  query?: URLSearchParams,
): string {
  const path = `${V1}/topic-versions/${encodeURIComponent(topicVersionId)}/signal-preview`;
  if (!query || query.toString() === "") return path;
  return nestV1PathWithQuery(path, query);
}

export function nestV1RecommendationsSimilarTopicsPath(
  topicId: string,
  query?: URLSearchParams,
): string {
  const path = `${V1}/recommendations/similar-topics?topicId=${encodeURIComponent(topicId)}`;
  if (!query || query.toString() === "") return path;
  const extra = query.toString();
  return `${path}&${extra}`;
}

export function nestV1RecommendationsSimilarEntitiesPath(
  entityId: string,
  query?: URLSearchParams,
): string {
  const path = `${V1}/recommendations/similar-entities?entityId=${encodeURIComponent(entityId)}`;
  if (!query || query.toString() === "") return path;
  const extra = query.toString();
  return `${path}&${extra}`;
}

/** `'path' + 可选 ?query`（不含 origin）。 */
export function nestV1PathWithQuery(
  path: string,
  params: URLSearchParams,
): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function nestV1RealtimeStreamPath(params: URLSearchParams): string {
  return nestV1PathWithQuery(`${V1}/realtime/stream`, params);
}

/**
 * 文档/界面展示用（含 `:param` 占位），**勿**用于实际 HTTP path。
 */
export const NEST_V1_DOC = {
  topic: "/v1/topics/:slug",
  topicsVersions: "/v1/topics/:slug/versions",
  topicsLeaderboard: "/v1/topics/:slug/leaderboard",
  topicsTrendAnalyses: "/v1/topics/:slug/trend-analyses",
  topicsSnapshots: "/v1/topics/:slug/snapshots",
  topicVersionPolicy: "/v1/topic-versions/:id/policy",
  trendsHot: "/v1/trends/hot",
  trendsAnomalies: "/v1/trends/anomalies",
  trendsAlertsAdmin: "/admin/trends/alerts",
  entityRankHistory: "/v1/entities/:id/rank-history",
  entityTimeline: "/v1/entities/:id/timeline",
  entityMetrics: "/v1/entities/:id/metrics",
  topicVersionCompare: "/v1/topic-versions/compare",
  topicVersionSignalPreview: "/v1/topic-versions/:id/signal-preview",
  rankingsStatus: "/v1/rankings/:topicRankingId/status",
  jobRanking: "/v1/jobs/ranking/:jobId",
  crawlTask: "/v1/crawl/tasks/:id",
  crawlTasksList: "/v1/crawl/tasks",
  crawlSourceUrls: "/v1/crawl/sources/:sourceId/urls",
  crawlCheckpoint: "/v1/crawl/checkpoints/:crawlerName",
  snapshotsAnalyses: "/v1/snapshots/:id/analyses",
  snapshotsScoreBreakdowns: "/v1/snapshots/:id/score-breakdowns",
  realtimeStream: "/v1/realtime/stream",
} as const;
