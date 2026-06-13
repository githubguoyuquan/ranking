"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { CONSOLE_PREFIX } from "@/lib/admin-web-paths";
import { SITE_HREF, siteSearchPath } from "@/lib/site-web-paths";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: SITE_HREF.home, label: "首页" },
  { href: SITE_HREF.hot, label: "热榜" },
  { href: SITE_HREF.trends, label: "涨榜" },
  { href: SITE_HREF.search, label: "搜索" },
] as const;

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="打开菜单"
            onClick={() => setOpen((v) => !v)}
          >
            <MenuIcon />
          </Button>
          <Link
            href={SITE_HREF.home}
            className="text-lg font-semibold tracking-tight"
            onClick={() => setOpen(false)}
          >
            Ranking
          </Link>
          <nav
            className={cn(
              "ml-auto flex flex-wrap items-center gap-1 text-sm",
              open
                ? "absolute left-0 right-0 top-14 flex-col items-stretch border-b border-border bg-background p-3 md:static md:flex-row md:border-0 md:p-0"
                : "hidden md:flex",
            )}
            aria-label="主导航"
          >
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 hover:bg-muted",
                  pathname === item.href ||
                    (item.href === SITE_HREF.hot &&
                      (pathname.startsWith("/topics/") || pathname === SITE_HREF.hot))
                    ? "bg-muted font-medium"
                    : undefined,
                )}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={siteSearchPath()}
              className="rounded-md px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              发现
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        <p>
          数据由 Ranking 平台实时计算 ·{" "}
          <Link href={CONSOLE_PREFIX} className="underline underline-offset-2">
            运营入口
          </Link>
        </p>
      </footer>
    </div>
  );
}
