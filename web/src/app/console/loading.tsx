import { Suspense } from "react";

import { AdminCopyCurrentPageButton } from "@/components/admin-copy-current-page-button";
import { AdminFooterNav } from "@/components/admin-footer-nav";

export default function Loading() {
  return (
    <div
      className="flex min-h-[12rem] flex-col gap-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div
          className="flex w-full max-w-md flex-col gap-2 px-1"
          aria-hidden
        >
          <div className="h-4 w-3/5 max-w-[12rem] animate-pulse rounded bg-muted" />
          <div className="h-4 w-4/5 max-w-[16rem] animate-pulse rounded bg-muted" />
          <div className="h-28 w-full animate-pulse rounded-md bg-muted/60" />
        </div>
        <p className="text-sm text-muted-foreground">加载中…</p>
        <p className="text-center text-xs text-muted-foreground">
          仍可通过下方链接离开本页；目标地址已反映在浏览器地址栏，可先复制分享。
        </p>
        <Suspense fallback={null}>
          <AdminCopyCurrentPageButton className="h-7 min-w-[7.5rem] justify-center text-xs" />
        </Suspense>
      </div>
      <AdminFooterNav
        showBackToHome={false}
        className="border-t border-border pt-6 opacity-90"
      />
    </div>
  );
}
