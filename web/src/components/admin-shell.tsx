"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect } from "react";

import {
  AdminChromeProvider,
  useAdminChrome,
} from "@/components/admin-chrome-context";
import { AdminCopyCurrentPageButton } from "@/components/admin-copy-current-page-button";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { ADMIN_HREF, ADMIN_SNAPSHOTS_ROUTE_PREFIX } from "@/lib/admin-web-paths";
import { getApiBase } from "@/lib/api";
import { cn } from "@/lib/utils";

const links = [
  { href: ADMIN_HREF.home, label: "概览" },
  { href: ADMIN_HREF.search, label: "搜索" },
  { href: ADMIN_HREF.reindex, label: "索引" },
  { href: ADMIN_HREF.entities, label: "实体" },
  { href: ADMIN_HREF.crawl, label: "爬虫" },
  { href: ADMIN_HREF.crawlMonitor, label: "引擎监控" },
  { href: ADMIN_HREF.outbox, label: "Outbox" },
  { href: ADMIN_HREF.seed, label: "演示数据" },
  { href: ADMIN_HREF.rankingsRun, label: "运行排行" },
  { href: ADMIN_HREF.topics, label: "话题版本" },
  { href: ADMIN_HREF.snapshotsCompare, label: "快照对比" },
  { href: ADMIN_HREF.compliance, label: "合规" },
  { href: ADMIN_HREF.scale, label: "规模" },
] as const;

function AdminShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const apiBase = getApiBase();
  const { origin } = useAdminAppUrl();
  const { sidebarHidden, setSidebarHidden } = useAdminChrome();

  useEffect(() => {
    if (!pathname.startsWith(ADMIN_HREF.crawlMonitor)) {
      setSidebarHidden(false);
    }
  }, [pathname, setSidebarHidden]);

  return (
    <div className="flex min-h-screen">
      <a
        href="#admin-main"
        className="fixed left-3 top-2 z-[100] -translate-y-[120%] rounded-md bg-primary px-3 py-2 text-sm leading-none text-primary-foreground opacity-0 shadow-md transition-[transform,opacity] focus:translate-y-0 focus:opacity-100 focus:outline-none"
      >
        跳到正文
      </a>
      {!sidebarHidden ? (
        <aside
          className="w-56 shrink-0 border-r border-border bg-card/40 p-4 backdrop-blur-sm"
          aria-label="侧栏"
        >
          <div className="mb-6 font-semibold tracking-tight text-foreground">
            Ranking 管理台
          </div>
          <nav className="flex flex-col gap-0.5" aria-label="主要页面">
            {links.map((l) => {
              const active =
                pathname === l.href ||
                (l.href === ADMIN_HREF.snapshotsCompare &&
                  pathname.startsWith(ADMIN_SNAPSHOTS_ROUTE_PREFIX));
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-3 border-t border-border pt-3">
            <Suspense fallback={null}>
              <AdminCopyCurrentPageButton className="h-7 w-full justify-center text-xs" />
            </Suspense>
          </div>
          <div className="mt-8 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>API</span>
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                {apiBase}
              </code>
              <CopyTextButton
                text={apiBase}
                idleLabel="复制 API"
                className="h-5 px-1.5 text-[10px]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>站点</span>
              <code
                className="max-w-[9.5rem] truncate rounded bg-muted px-1 py-0.5 text-[10px]"
                title={origin || undefined}
              >
                {origin || "…"}
              </code>
              <CopyTextButton
                text={origin}
                idleLabel="复制站点"
                className="h-5 px-1.5 text-[10px]"
              />
            </div>
            <p>
              前端默认端口{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">3001</code>
            </p>
          </div>
        </aside>
      ) : null}
      <main
        id="admin-main"
        className={cn(
          "min-w-0 flex-1 p-6 md:p-8",
          sidebarHidden && "w-full max-w-none",
        )}
        tabIndex={-1}
        aria-label="正文内容"
      >
        {children}
      </main>
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AdminChromeProvider>
      <AdminShellInner>{children}</AdminShellInner>
    </AdminChromeProvider>
  );
}
