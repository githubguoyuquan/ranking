"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import { cn } from "@/lib/utils";

const linkCls = "text-primary underline-offset-4 hover:underline";

export function AdminFooterNav({
  showBackToHome = true,
  className,
  justify = "start",
  leading,
}: {
  showBackToHome?: boolean;
  className?: string;
  justify?: "start" | "center";
  leading?: ReactNode;
}) {
  return (
    <nav
      aria-label="管理台页脚导航"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-sm",
        justify === "center" && "justify-center",
        className,
      )}
    >
      {leading}
      <Link href={ADMIN_HREF.rankingsRun} className={linkCls}>
        运行排行
      </Link>
      <Link href={ADMIN_HREF.reindex} className={linkCls}>
        索引维护
      </Link>
      <Link href={ADMIN_HREF.crawl} className={linkCls}>
        爬虫
      </Link>
      <Link href={ADMIN_HREF.outbox} className={linkCls}>
        Outbox
      </Link>
      <Link href={ADMIN_HREF.search} className={linkCls}>
        聚合搜索
      </Link>
      <Link href={ADMIN_HREF.entities} className={linkCls}>
        实体
      </Link>
      <Link href={ADMIN_HREF.topics} className={linkCls}>
        话题版本
      </Link>
      <Link href={ADMIN_HREF.snapshotsCompare} className={linkCls}>
        快照对比
      </Link>
      <Link href={ADMIN_HREF.seed} className={linkCls}>
        演示数据
      </Link>
      <CopyAdminPageUrlButton
        path={ADMIN_HREF.home}
        idleLabel="复制概览"
        className="h-6 px-2 text-xs"
      />
      {showBackToHome ? (
        <Link href={ADMIN_HREF.home} className={linkCls}>
          ← 返回概览
        </Link>
      ) : null}
    </nav>
  );
}
