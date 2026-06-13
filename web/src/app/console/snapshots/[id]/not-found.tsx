import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import Link from "next/link";

export default function SnapshotNotFound() {
  return (
    <div className="mx-auto max-w-md space-y-6 pt-12 text-center">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">未找到快照</h1>
        <p className="text-sm text-muted-foreground">
          请检查 id 或先运行种子数据 / 排行任务。
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
