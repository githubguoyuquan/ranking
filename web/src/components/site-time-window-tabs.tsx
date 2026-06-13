import Link from "next/link";

import { cn } from "@/lib/utils";

export const SITE_TIME_WINDOWS = [
  { value: "", label: "默认" },
  { value: "DAY", label: "日榜" },
  { value: "WEEK", label: "周榜" },
  { value: "MONTH", label: "月榜" },
] as const;

export function SiteTimeWindowTabs({
  active,
  hrefFor,
  ariaLabel = "时间窗口",
}: {
  active?: string;
  hrefFor: (timeWindow: string) => string;
  ariaLabel?: string;
}) {
  const current = active?.trim().toUpperCase() ?? "";

  return (
    <nav className="flex flex-wrap gap-1" aria-label={ariaLabel}>
      {SITE_TIME_WINDOWS.map((w) => {
        const isActive = w.value === "" ? current === "" : current === w.value;
        return (
          <Link
            key={w.value || "default"}
            href={hrefFor(w.value)}
            className={cn(
              "rounded-full px-3 py-1 text-sm transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
            )}
          >
            {w.label}
          </Link>
        );
      })}
    </nav>
  );
}
