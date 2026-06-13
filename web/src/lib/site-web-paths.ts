/** C 端用户站点路径（根路径，与 `src/app/(site)` 路由一致） */
export const SITE_HREF = {
  home: "/",
  search: "/search",
  trends: "/trends",
} as const;

export const DEFAULT_TOPIC_SLUG = "global-female-singers";

export function siteTopicPath(slug: string): string {
  const s = slug.trim() || DEFAULT_TOPIC_SLUG;
  return `/topics/${encodeURIComponent(s)}`;
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
