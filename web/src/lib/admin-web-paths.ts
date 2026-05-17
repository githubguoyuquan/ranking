import { TOPIC_SLUG_MAX_LEN } from "@/lib/admin-input-limits";

/** 快照详情、对比等共用 URL 前缀（侧栏高亮子路由） */
export const ADMIN_SNAPSHOTS_ROUTE_PREFIX = "/snapshots/";

/** 管理台固定路径（与 `src/app` 下路由一致；无 query） */
export const ADMIN_HREF = {
  home: "/",
  topics: "/topics",
  entities: "/entities",
  search: "/search",
  rankingsRun: "/rankings/run",
  snapshots: "/snapshots",
  snapshotsCompare: "/snapshots/compare",
  crawl: "/crawl",
  seed: "/seed",
  reindex: "/reindex",
  outbox: "/outbox",
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

/** Next 管理台快照详情动态路由 */
export function snapshotDetailAdminPath(snapshotId: string): string {
  const id = snapshotId.trim();
  if (id === "") return ADMIN_HREF.snapshots;
  return `${ADMIN_HREF.snapshots}/${encodeURIComponent(id)}`;
}

/**
 * 对比页路径；id 须经调用方校验。编码规则与既有「英文逗号分隔」一致。
 */
export function snapshotsCompareAdminPath(snapshotIds: string[]): string {
  const parts = snapshotIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => encodeURIComponent(id));
  if (parts.length === 0) return ADMIN_HREF.snapshotsCompare;
  return `${ADMIN_HREF.snapshotsCompare}?ids=${parts.join(",")}`;
}

/**
 * 浏览器打开管理台时的绝对地址（分享用）。`origin` 为空时退回为 `path`（仅路径 + query），便于未挂载到 window 时仍能复制相对路径。
 */
export function buildAdminAppAbsUrl(origin: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = origin.replace(/\/$/, "");
  return base ? `${base}${p}` : p;
}
