import { apiUrl } from "@/lib/api";
import {
  NEST_V1,
  nestV1CrawlCheckpointPath,
  nestV1CrawlSourceUrlsPath,
  nestV1CrawlSourcesListPath,
  nestV1CrawlTasksListPath,
  nestV1CrawlTaskPath,
  nestV1PathWithQuery,
  nestV1EntityRankHistoryPath,
  nestV1TopicVersionPolicyPath,
  nestV1TrendsHotPath,
  nestV1RankingJobPath,
  nestV1RankingStatusPath,
  nestV1SnapshotAnalysesPath,
  nestV1SnapshotPath,
  nestV1SnapshotScoreBreakdownsPath,
  nestV1TopicLeaderboardPath,
  nestV1TopicPath,
  nestV1TopicSnapshotsPath,
  nestV1TopicTrendAnalysesPath,
  nestV1TopicVersionsPath,
} from "@/lib/nest-api-paths";

const nestAbs = apiUrl;

export function nestSearchHealthUrl(): string {
  return nestAbs(NEST_V1.searchHealth);
}

export function nestClickhouseHealthUrl(): string {
  return nestAbs(NEST_V1.clickhouseHealth);
}

/** GET `NEST_V1.search` — pass the same `URLSearchParams` you use for the admin URL bar. */
export function nestSearchUrl(params: URLSearchParams): string {
  return nestAbs(nestV1PathWithQuery(NEST_V1.search, params));
}

/** GET `NEST_V1.searchEntities` */
export function nestSearchEntitiesUrl(params: URLSearchParams): string {
  return nestAbs(nestV1PathWithQuery(NEST_V1.searchEntities, params));
}

/** GET `NEST_V1.searchCrawledUrls`（PostgreSQL 子串检索） */
export function nestSearchCrawledUrlsUrl(params: URLSearchParams): string {
  return nestAbs(nestV1PathWithQuery(NEST_V1.searchCrawledUrls, params));
}

/** GET `NEST_V1.searchCrawledUrlsEs`（需 ES） */
export function nestSearchCrawledUrlsEsUrl(params: URLSearchParams): string {
  return nestAbs(nestV1PathWithQuery(NEST_V1.searchCrawledUrlsEs, params));
}

export function nestRankingStatusUrl(topicRankingId: string): string {
  return nestAbs(nestV1RankingStatusPath(topicRankingId));
}

export function nestRankingRunUrl(): string {
  return nestAbs(NEST_V1.rankingsRun);
}

export function nestRankingJobUrl(jobId: string): string {
  return nestAbs(nestV1RankingJobPath(jobId));
}

export function nestSnapshotV1Url(snapshotId: string, query?: URLSearchParams): string {
  return nestAbs(nestV1SnapshotPath(snapshotId, query));
}

export function nestSnapshotAnalysesUrl(
  snapshotId: string,
  query?: URLSearchParams,
): string {
  return nestAbs(nestV1SnapshotAnalysesPath(snapshotId, query));
}

export function nestSnapshotScoreBreakdownsUrl(snapshotId: string): string {
  return nestAbs(nestV1SnapshotScoreBreakdownsPath(snapshotId));
}

export function nestSnapshotCompareUrl(): string {
  return nestAbs(NEST_V1.snapshotsCompare);
}

export function nestTopicUrl(topicSlug: string): string {
  return nestAbs(nestV1TopicPath(topicSlug));
}

export function nestTopicVersionsUrl(topicSlug: string): string {
  return nestAbs(nestV1TopicVersionsPath(topicSlug));
}

export function nestTopicLeaderboardUrl(
  topicSlug: string,
  query?: URLSearchParams,
): string {
  return nestAbs(nestV1TopicLeaderboardPath(topicSlug, query));
}

export function nestTopicTrendAnalysesUrl(
  topicSlug: string,
  query?: URLSearchParams,
): string {
  return nestAbs(nestV1TopicTrendAnalysesPath(topicSlug, query));
}

export function nestTopicSnapshotsUrl(
  topicSlug: string,
  query?: URLSearchParams,
): string {
  return nestAbs(nestV1TopicSnapshotsPath(topicSlug, query));
}

export function nestEntityRankHistoryUrl(
  entityId: string,
  query: URLSearchParams,
): string {
  return nestAbs(nestV1EntityRankHistoryPath(entityId, query));
}

export function nestTopicVersionPolicyUrl(topicVersionId: string): string {
  return nestAbs(nestV1TopicVersionPolicyPath(topicVersionId));
}

export function nestTrendsHotUrl(query?: URLSearchParams): string {
  return nestAbs(nestV1TrendsHotPath(query));
}

export function nestCrawlSourcesListUrl(limit: number): string {
  return nestAbs(nestV1CrawlSourcesListPath(limit));
}

export function nestCrawlSourcesUrl(): string {
  return nestAbs(NEST_V1.crawlSources);
}

export function nestCrawlSourceUrlsUrl(sourceId: string, limit: number): string {
  return nestAbs(nestV1CrawlSourceUrlsPath(sourceId, limit));
}

export function nestCrawlTasksUrl(): string {
  return nestAbs(NEST_V1.crawlTasks);
}

/** GET 最近任务列表（可选 sourceId） */
export function nestCrawlTasksListUrl(limit: number, sourceId?: string): string {
  return nestAbs(nestV1CrawlTasksListPath(limit, sourceId));
}

export function nestCrawlTaskUrl(taskId: string): string {
  return nestAbs(nestV1CrawlTaskPath(taskId));
}

export function nestCrawlCheckpointUrl(crawlerName: string): string {
  return nestAbs(nestV1CrawlCheckpointPath(crawlerName));
}

/** `POST` **`NEST_V1.crawlUrls`**（注册 seed URL 等） */
export function nestCrawlUrlsRegisterUrl(): string {
  return nestAbs(NEST_V1.crawlUrls);
}
