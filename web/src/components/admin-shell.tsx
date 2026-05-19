"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import {
  AdminChromeProvider,
  useAdminChrome,
} from "@/components/admin-chrome-context";
import { AdminCopyCurrentPageButton } from "@/components/admin-copy-current-page-button";
import { AdminSidebarNav } from "@/components/admin-sidebar-nav";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
import { Button } from "@/components/ui/button";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import { getApiBase } from "@/lib/api";
import { cn } from "@/lib/utils";

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

function SidebarFooter({ apiBase, origin }: { apiBase: string; origin: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>API</span>
        <code className="max-w-[10rem] truncate rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {apiBase}
        </code>
        <CopyTextButton
          text={apiBase}
          idleLabel="复制"
          className="h-6 px-1.5 text-xs"
        />
      </div>
      {origin ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>站点</span>
          <code
            className="max-w-[10rem] truncate rounded bg-muted px-1 py-0.5 font-mono text-xs"
            title={origin}
          >
            {origin}
          </code>
        </div>
      ) : null}
    </div>
  );
}

function AdminShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const apiBase = getApiBase();
  const { origin } = useAdminAppUrl();
  const { sidebarHidden, setSidebarHidden } = useAdminChrome();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!pathname.startsWith(ADMIN_HREF.crawlMonitor)) {
      setSidebarHidden(false);
    }
  }, [pathname, setSidebarHidden]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const showSidebar = !sidebarHidden;

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <a
        href="#admin-main"
        className="fixed left-3 top-2 z-[100] -translate-y-[120%] rounded-md bg-primary px-3 py-2 text-sm leading-none text-primary-foreground opacity-0 shadow-md transition-[transform,opacity] focus:translate-y-0 focus:opacity-100 focus:outline-none"
      >
        跳到正文
      </a>

      {showSidebar ? (
        <>
          {mobileNavOpen ? (
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              aria-label="关闭菜单"
              onClick={() => setMobileNavOpen(false)}
            />
          ) : null}

          <aside
            id="admin-sidebar"
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex h-svh max-h-svh w-[min(18rem,88vw)] flex-col border-r border-sidebar-border bg-sidebar p-4 shadow-lg transition-transform duration-200",
              "lg:relative lg:sticky lg:top-0 lg:z-auto lg:h-svh lg:max-h-svh lg:w-60 lg:shrink-0 lg:translate-x-0 lg:shadow-none",
              mobileNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
            )}
            aria-label="侧栏"
          >
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
              <Link
                href={ADMIN_HREF.home}
                className="text-lg font-semibold tracking-tight text-sidebar-foreground"
                onClick={() => setMobileNavOpen(false)}
              >
                Ranking 管理台
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                aria-label="关闭导航"
                onClick={() => setMobileNavOpen(false)}
              >
                <span className="text-lg leading-none">×</span>
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 pb-2">
              <AdminSidebarNav onNavigate={() => setMobileNavOpen(false)} />
            </div>

            <div className="mt-3 shrink-0 space-y-3 border-t border-sidebar-border pt-3">
              <Suspense fallback={null}>
                <AdminCopyCurrentPageButton className="h-8 w-full justify-center text-xs" />
              </Suspense>
              <SidebarFooter apiBase={apiBase} origin={origin} />
            </div>
          </aside>
        </>
      ) : null}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {showSidebar ? (
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur-md lg:hidden">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-expanded={mobileNavOpen}
              aria-controls="admin-sidebar"
              onClick={() => setMobileNavOpen(true)}
            >
              <MenuIcon />
            </Button>
            <span className="truncate text-base font-medium">Ranking 管理台</span>
          </header>
        ) : null}

        <main
          id="admin-main"
          className={cn(
            "min-h-0 min-w-0 flex-1",
            showSidebar ? "p-4 sm:p-6 lg:p-8" : "w-full p-4 sm:p-6 md:p-8",
          )}
          tabIndex={-1}
          aria-label="正文内容"
        >
          {children}
        </main>
      </div>
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
