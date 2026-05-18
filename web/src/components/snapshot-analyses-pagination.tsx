"use client";

import type { SnapshotPageAnalysisKind } from "@/lib/snapshot-analysis-kind-query";
import { snapshotDetailAdminPath } from "@/lib/admin-web-paths";
import { buildSnapshotDetailAdminQuery } from "@/lib/snapshot-detail-search-params";
import { cn } from "@/lib/utils";
import Link from "next/link";

export type SnapshotAnalysesPaginationProps = {
  snapshotId: string;
  analysisKind: SnapshotPageAnalysisKind;
  page: number;
  limit: number;
  /** `GET …/analyses` 的 total；未知时不渲染下一页 */
  total: number | null;
};

const LIMIT_PRESETS = [25, 50, 100] as const;

export function SnapshotAnalysesPagination(props: SnapshotAnalysesPaginationProps) {
  const { snapshotId, analysisKind, page, limit, total } = props;

  if (total == null || total <= 0) {
    return null;
  }

  const hasPrev = page > 1;
  const hasNext = page * limit < total;

  const hrefFor = (p: number) => {
    const qs = buildSnapshotDetailAdminQuery({
      analysisKind,
      analysisPage: p,
      analysisLimit: limit,
    });
    return snapshotDetailAdminPath(snapshotId, qs.toString() ? qs : undefined);
  };

  const hrefForLimit = (newLimit: number) => {
    const qs = buildSnapshotDetailAdminQuery({
      analysisKind,
      analysisPage: newLimit === limit ? page : 1,
      analysisLimit: newLimit,
    });
    return snapshotDetailAdminPath(snapshotId, qs.toString() ? qs : undefined);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      role="navigation"
      aria-label="简报分页"
    >
      <span>
        第 {page} 页 · 每页 {limit} 条 · 共 {total} 条
      </span>
      <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <span className="text-muted-foreground/80">每页</span>
        {LIMIT_PRESETS.map((n) => {
          const active = n === limit;
          return active ? (
            <span
              key={n}
              className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-medium text-foreground"
            >
              {n}
            </span>
          ) : (
            <Link
              key={n}
              href={hrefForLimit(n)}
              className={cn(
                "rounded-md border border-border px-1.5 py-0.5",
                "text-primary underline-offset-2 hover:underline",
              )}
            >
              {n}
            </Link>
          );
        })}
      </span>
      {hasPrev ? (
        <Link
          href={hrefFor(page - 1)}
          className={cn(
            "rounded-md border border-border px-2 py-0.5",
            "text-primary underline-offset-2 hover:underline",
          )}
        >
          上一页
        </Link>
      ) : (
        <span className="rounded-md border border-border/50 px-2 py-0.5 text-muted-foreground/50">
          上一页
        </span>
      )}
      {hasNext ? (
        <Link
          href={hrefFor(page + 1)}
          className={cn(
            "rounded-md border border-border px-2 py-0.5",
            "text-primary underline-offset-2 hover:underline",
          )}
        >
          下一页
        </Link>
      ) : (
        <span className="rounded-md border border-border/50 px-2 py-0.5 text-muted-foreground/50">
          下一页
        </span>
      )}
    </div>
  );
}
