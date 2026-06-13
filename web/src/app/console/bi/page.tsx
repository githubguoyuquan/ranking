import { AdminFooterNav } from "@/components/admin-footer-nav";
import { BiDashboard } from "@/components/bi-dashboard";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "BI 大屏 | Ranking 管理台",
  description: "运营 KPI、快照趋势、涨榜热点与依赖健康一屏总览",
};

export default function BiPage() {
  return (
    <div className="space-y-6">
      <BiDashboard />
      <AdminFooterNav
        className="border-t border-border/60 pt-6"
        leading={
          <Link
            href={ADMIN_HREF.home}
            className="text-primary underline-offset-4 hover:underline"
          >
            系统概览
          </Link>
        }
      />
    </div>
  );
}
