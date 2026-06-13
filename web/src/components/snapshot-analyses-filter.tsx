"use client";

import type { SnapshotPageAnalysisKind } from "@/lib/snapshot-analysis-kind-query";
import { snapshotDetailAdminPath } from "@/lib/admin-web-paths";
import { buildSnapshotDetailAdminQuery } from "@/lib/snapshot-detail-search-params";
import { cn } from "@/lib/utils";
import Link from "next/link";

export type SnapshotAnalysesFilterProps = {
  snapshotId: string;
  currentKind: SnapshotPageAnalysisKind;
  /** 与当前列表 `analysisLimit` 一致（换类型时保留每页条数） */
  listLimit: number;
};

const LINKS: { kind: SnapshotPageAnalysisKind; label: string }[] = [
  { kind: "", label: "全部" },
  { kind: "followup", label: "跟进" },
  { kind: "trend", label: "趋势" },
  { kind: "credibility", label: "可信" },
  { kind: "factcheck", label: "核查" },
  { kind: "trend_analysis", label: "涨榜" },
  { kind: "timeseries", label: "时序" },
  { kind: "ranking", label: "排行" },
  { kind: "default", label: "默认" },
];

export function SnapshotAnalysesFilter(props: SnapshotAnalysesFilterProps) {
  const { snapshotId, currentKind, listLimit } = props;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="navigation"
      aria-label="简报类型筛选"
    >
      <span className="mr-1 text-xs text-muted-foreground">筛选</span>
      {LINKS.map(({ kind, label }) => {
        const qs = buildSnapshotDetailAdminQuery({
          analysisKind: kind,
          analysisPage: 1,
          analysisLimit: listLimit,
        });
        const href = snapshotDetailAdminPath(
          snapshotId,
          qs.toString() ? qs : undefined,
        );
        const active = kind === currentKind;
        return (
          <Link
            key={kind || "all"}
            href={href}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs transition-colors",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
