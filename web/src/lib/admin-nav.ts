import { ADMIN_HREF, ADMIN_SNAPSHOTS_ROUTE_PREFIX } from "@/lib/admin-web-paths";

export type AdminNavItem = {
  href: string;
  label: string;
  /** 子路径也高亮（如 /snapshots/:id） */
  matchPrefix?: string;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: ADMIN_HREF.home, label: "系统概览" },
  { href: ADMIN_HREF.search, label: "聚合搜索" },
  { href: ADMIN_HREF.entities, label: "实体管理" },
  { href: ADMIN_HREF.reindex, label: "索引维护" },
  { href: ADMIN_HREF.rankingsRun, label: "运行排行" },
  { href: ADMIN_HREF.topics, label: "话题版本" },
  {
    href: ADMIN_HREF.snapshotsCompare,
    label: "快照对比",
    matchPrefix: ADMIN_SNAPSHOTS_ROUTE_PREFIX,
  },
  { href: ADMIN_HREF.trends, label: "热点趋势" },
  { href: ADMIN_HREF.crawl, label: "数据源与任务" },
  { href: ADMIN_HREF.crawlMonitor, label: "引擎监控" },
  { href: ADMIN_HREF.outbox, label: "Outbox" },
  { href: ADMIN_HREF.seed, label: "演示数据" },
  { href: ADMIN_HREF.compliance, label: "合规导出" },
  { href: ADMIN_HREF.scale, label: "规模运维" },
];

export function isAdminNavActive(pathname: string, item: AdminNavItem): boolean {
  if (pathname === item.href) return true;
  if (item.matchPrefix && pathname.startsWith(item.matchPrefix)) return true;
  return false;
}
