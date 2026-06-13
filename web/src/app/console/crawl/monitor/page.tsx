import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CrawlMonitorDashboard } from "@/components/crawl-monitor-dashboard";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "爬虫引擎监控 | Ranking 管理台",
  description: "实时爬虫遥测与任务入轨控制台",
};

export default function CrawlMonitorPage() {
  return (
    <div className="space-y-8">
      <CrawlMonitorDashboard />
      <AdminFooterNav
        className="border-t border-border/60 pt-8"
        leading={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href={ADMIN_HREF.home}
              className="text-primary underline-offset-4 hover:underline"
            >
              系统概览
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link
              href={ADMIN_HREF.crawl}
              className="text-primary underline-offset-4 hover:underline"
            >
              经典爬虫表单
            </Link>
          </span>
        }
      />
    </div>
  );
}
