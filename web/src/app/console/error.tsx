"use client";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
import { Button } from "@/components/ui/button";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-12">
      <h1 className="text-xl font-semibold tracking-tight">页面出错了</h1>
      <p className="text-sm text-muted-foreground">
        渲染异常已记入控制台。若为预览/构建问题，可返回概览重试。
      </p>
      <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs whitespace-pre-wrap">
        {error.message}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => reset()}>
          重试
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={ADMIN_HREF.home}>概览</Link>
        </Button>
        <CopyAdminPageUrlButton
          path={ADMIN_HREF.home}
          idleLabel="复制概览"
          className="h-8 px-2 text-xs"
        />
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={ADMIN_HREF.seed}>演示数据</Link>
        </Button>
        <CopyAdminPageUrlButton
          path={ADMIN_HREF.seed}
          idleLabel="复制演示页"
          className="h-8 px-2 text-xs"
        />
      </div>
      <AdminFooterNav className="border-t border-border pt-6" />
    </div>
  );
}
