/** C 端用户站点路径（根路径，与 `src/app/(site)` 路由一致） */
export const SITE_HREF = {
  home: "/",
  hot: "/hot",
  search: "/search",
  trends: "/trends",
} as const;

export const DEFAULT_TOPIC_SLUG = "global-female-singers";

export function siteTopicPath(
  slug: string,
  query?: { timeWindow?: string; version?: string },
): string {
  const s = slug.trim() || DEFAULT_TOPIC_SLUG;
  const base = `/topics/${encodeURIComponent(s)}`;
  const q = new URLSearchParams();
  if (query?.timeWindow?.trim()) q.set("timeWindow", query.timeWindow.trim());
  if (query?.version?.trim()) q.set("version", query.version.trim());
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

export function siteEntityPath(entityId: string): string {
  return `/entities/${encodeURIComponent(entityId.trim())}`;
}

export function siteSnapshotPath(snapshotId: string): string {
  return `/snapshots/${encodeURIComponent(snapshotId.trim())}`;
}

export function siteSearchPath(q?: string): string {
  if (!q?.trim()) return SITE_HREF.search;
  return `${SITE_HREF.search}?${new URLSearchParams({ q: q.trim() }).toString()}`;
}

export function siteTrendsPath(params?: { timeWindow?: string; limit?: string }): string {
  const q = new URLSearchParams();
  if (params?.timeWindow?.trim()) q.set("timeWindow", params.timeWindow.trim());
  if (params?.limit?.trim()) q.set("limit", params.limit.trim());
  const qs = q.toString();
  return qs ? `${SITE_HREF.trends}?${qs}` : SITE_HREF.trends;
}

export function siteHotPath(params?: { timeWindow?: string; topicsLimit?: string }): string {
  const q = new URLSearchParams();
  if (params?.timeWindow?.trim()) q.set("timeWindow", params.timeWindow.trim());
  if (params?.topicsLimit?.trim()) q.set("topicsLimit", params.topicsLimit.trim());
  const qs = q.toString();
  return qs ? `${SITE_HREF.hot}?${qs}` : SITE_HREF.hot;
}
