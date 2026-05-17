"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { getApiBase } from "@/lib/api";
import { ADMIN_HREF, ADMIN_SNAPSHOTS_ROUTE_PREFIX } from "@/lib/admin-web-paths";

const links = [
  { href: ADMIN_HREF.home, label: "概览" },
  { href: ADMIN_HREF.search, label: "搜索" },
  { href: ADMIN_HREF.reindex, label: "索引" },
  { href: ADMIN_HREF.entities, label: "实体" },
  { href: ADMIN_HREF.crawl, label: "爬虫" },
  { href: ADMIN_HREF.outbox, label: "Outbox" },
  { href: ADMIN_HREF.seed, label: "演示数据" },
  { href: ADMIN_HREF.rankingsRun, label: "运行排行" },
  { href: ADMIN_HREF.topics, label: "话题版本" },
  { href: ADMIN_HREF.snapshotsCompare, label: "快照对比" },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <a
        href="#admin-main"
        className="fixed left-3 top-2 z-[100] -translate-y-[120%] rounded-md bg-primary px-3 py-2 text-sm leading-none text-primary-foreground opacity-0 shadow-md transition-[transform,opacity] focus:translate-y-0 focus:opacity-100 focus:outline-none"
      >
        跳到正文
      </a>
      <aside className="w-56 shrink-0 border-r border-border bg-card/40 p-4 backdrop-blur-sm" aria-label="侧栏">
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
        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          API{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
            {getApiBase()}
          </code>
          <br />
          前端默认端口{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">3001</code>
        </p>
      </aside>
      <main
        id="admin-main"
        className="min-w-0 flex-1 p-6 md:p-8"
        tabIndex={-1}
        aria-label="正文内容"
      >
        {children}
      </main>
    </div>
  );
}
