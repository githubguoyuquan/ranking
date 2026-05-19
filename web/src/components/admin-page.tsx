import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type AdminPageWidth = "narrow" | "default" | "wide" | "full";

const widthClass: Record<AdminPageWidth, string> = {
  narrow: "max-w-3xl",
  default: "max-w-none",
  wide: "max-w-7xl",
  full: "max-w-none",
};

export function AdminPage({
  title,
  description,
  children,
  width = "full",
  className,
  headerExtra,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  width?: AdminPageWidth;
  className?: string;
  headerExtra?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full space-y-6",
        width === "narrow" && "mx-auto",
        widthClass[width],
        className,
      )}
    >
      {title || description || headerExtra ? (
        <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            {title ? (
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
            ) : null}
            {description ? (
              <div className="text-base leading-relaxed text-muted-foreground">
                {description}
              </div>
            ) : null}
          </div>
          {headerExtra ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{headerExtra}</div>
          ) : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}