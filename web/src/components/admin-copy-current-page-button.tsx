"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";

export function AdminCopyCurrentPageButton({
  className,
}: {
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const path = useMemo(() => {
    const q = searchParams.toString();
    return q ? `${pathname}?${q}` : pathname;
  }, [pathname, searchParams]);

  return (
    <CopyAdminPageUrlButton
      path={path}
      idleLabel="复制当前页"
      className={className}
    />
  );
}
