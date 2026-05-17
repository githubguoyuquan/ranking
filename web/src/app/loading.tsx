import { AdminFooterNav } from "@/components/admin-footer-nav";

export default function Loading() {
  return (
    <div className="flex min-h-[12rem] flex-col gap-8">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>加载中…</p>
        <p className="text-xs">仍可通过下方链接离开本页。</p>
      </div>
      <AdminFooterNav
        showBackToHome={false}
        className="border-t border-border pt-6 opacity-90"
      />
    </div>
  );
}
