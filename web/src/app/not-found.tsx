import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-6 pt-12 text-center">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">页面不存在</h1>
        <p className="text-sm text-muted-foreground">
          路径无效或资源已迁移。可从概览进入各管理页。
        </p>
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm">
          <Link href={ADMIN_HREF.home} className="text-primary underline-offset-4 hover:underline">
            概览
          </Link>
          <CopyAdminPageUrlButton
            path={ADMIN_HREF.home}
            idleLabel="复制概览"
            className="h-6 px-2 text-xs"
          />
          <span className="text-muted-foreground">·</span>
          <Link href={ADMIN_HREF.seed} className="text-primary underline-offset-4 hover:underline">
            演示数据
          </Link>
          <CopyAdminPageUrlButton
            path={ADMIN_HREF.seed}
            idleLabel="复制演示页"
            className="h-6 px-2 text-xs"
          />
        </p>
      </div>
      <AdminFooterNav
        justify="center"
        className="border-t border-border pt-6"
      />
    </div>
  );
}
