"use client";

import { CopyTextButton } from "@/components/copy-snapshot-id-button";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";

/** 复制当前站点 + 管理台 path（含 query）的完整 URL；首帧 origin 未就绪时等同复制 path。 */
export function CopyAdminPageUrlButton({
  path,
  idleLabel,
  className,
}: {
  path: string;
  idleLabel: string;
  className?: string;
}) {
  const { abs } = useAdminAppUrl();
  return (
    <CopyTextButton text={abs(path)} idleLabel={idleLabel} className={className} />
  );
}
