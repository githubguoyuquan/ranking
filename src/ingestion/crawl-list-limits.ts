/** `GET /v1/crawl/tasks` 的 `limit` 与 `listCrawlTasks` 共用钳制 */
export function clampCrawlTasksListTake(limit: number): number {
  const n = Number.isFinite(limit) ? Math.trunc(limit) : 30;
  return Math.min(Math.max(n, 1), 100);
}
