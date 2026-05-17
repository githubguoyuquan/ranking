"use client";

import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
import Link from "next/link";
import type { ReactNode } from "react";

/** 管理台 Next 深链：文案链接 + 复制本站完整 URL（与 `href` 同 path/query）。 */
export function AdminQuickEntryRow({
  href,
  copyLabel = "复制链接",
  children,
}: {
  href: string;
  copyLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Link
        className="text-primary underline-offset-4 hover:underline"
        href={href}
      >
        {children}
      </Link>
      <CopyAdminPageUrlButton path={href} idleLabel={copyLabel} className="h-6" />
    </div>
  );
}
