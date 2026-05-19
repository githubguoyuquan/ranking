import { TOPIC_SLUG_MAX_LEN } from "@/lib/admin-input-limits";

/** 快照详情、对比等共用 URL 前缀（侧栏高亮子路由） */
export const ADMIN_SNAPSHOTS_ROUTE_PREFIX = "/snapshots/";

/** 管理台固定路径（与 `src/app` 下路由一致；无 query） */
export const ADMIN_HREF = {
  home: "/",
  topics: "/topics",
  entities: "/entities",
  entityRankHistory: "/entities/rank-history",
  trends: "/trends",
  search: "/search",
  rankingsRun: "/rankings/run",
  snapshots: "/snapshots",
  snapshotsCompare: "/snapshots/compare",
  crawl: "/crawl",
  crawlMonitor: "/crawl/monitor",
  seed: "/seed",
  reindex: "/reindex",
  outbox: "/outbox",
  compliance: "/compliance",
  scale: "/scale",
} as const;

/** `/topics` 管理页；`slug` 与演示 seed / 热榜页一致，上限见 `TOPIC_SLUG_MAX_LEN` */
export function topicsAdminPath(rawSlug: string): string {
  const s = rawSlug.trim();
  if (s === "") return ADMIN_HREF.topics;
  const slug =
    s.length > TOPIC_SLUG_MAX_LEN ? s.slice(0, TOPIC_SLUG_MAX_LEN) : s;
  return `${ADMIN_HREF.topics}?${new URLSearchParams({ slug }).toString()}`;
}

/** `/rankings/run` 预填 topicVersionId（十进制字符串由调用方保证） */
export function rankingsRunAdminPath(topicVersionId: string): string {
  const t = topicVersionId.trim();
  if (t === "") return ADMIN_HREF.rankingsRun;
  return `${ADMIN_HREF.rankingsRun}?${new URLSearchParams({ topicVersionId: t }).toString()}`;
}

/** 实体名次曲线：query 须含 `entityId`、`topicSlug`（与 Nest `rank-history` 一致） */
export function entityRankHistoryAdminPath(
  entityId: string,
  topicSlug: string,
  extra?: { timeWindow?: string; limit?: string },
): string {
  const q = new URLSearchParams();
  q.set("entityId", entityId.trim());
  const slug =
    topicSlug.trim().length > TOPIC_SLUG_MAX_LEN
      ? topicSlug.trim().slice(0, TOPIC_SLUG_MAX_LEN)
      : topicSlug.trim();
  q.set("topicSlug", slug || "global-female-singers");
  if (extra?.timeWindow?.trim()) q.set("timeWindow", extra.timeWindow.trim());
  if (extra?.limit?.trim()) q.set("limit", extra.limit.trim());
  return `${ADMIN_HREF.entityRankHistory}?${q.toString()}`;
}

/** Next 管理台快照详情动态路由；可选 `analysisKind` 等 query 与页内筛选对齐 */
export function snapshotDetailAdminPath(
  snapshotId: string,
  query?: URLSearchParams,
): string {
  const id = snapshotId.trim();
  if (id === "") return ADMIN_HREF.snapshots;
  const base = `${ADMIN_HREF.snapshots}/${encodeURIComponent(id)}`;
  const qs = query?.toString() ?? "";
  return qs ? `${base}?${qs}` : base;
}

/**
 * 对比页路径；id 须经调用方校验。编码规则与既有「英文逗号分隔」一致。
 * `includeAiStats` 与 `POST /v1/snapshots/compare` body 选项对齐，便于分享带选项的链接。
 */
export function snapshotsCompareAdminPath(
  snapshotIds: string[],
  extra?: { includeAiStats?: boolean },
): string {
  const parts = snapshotIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => encodeURIComponent(id));
  if (parts.length === 0) return ADMIN_HREF.snapshotsCompare;
  const base = `${ADMIN_HREF.snapshotsCompare}?ids=${parts.join(",")}`;
  if (extra?.includeAiStats === true) return `${base}&includeAiStats=1`;
  return base;
}

/**
 * 浏览器打开管理台时的绝对地址（分享用）。`origin` 为空时退回为 `path`（仅路径 + query），便于未挂载到 window 时仍能复制相对路径。
 */
export function buildAdminAppAbsUrl(origin: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = origin.replace(/\/$/, "");
  return base ? `${base}${p}` : p;
}
