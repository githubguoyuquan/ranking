"use client";

import Link from "next/link";

import {
  ADMIN_HREF,
  topicManageAdminPath,
  topicsAdminPath,
} from "@/lib/admin-web-paths";
import { cn } from "@/lib/utils";

type TopicModulePage = "versions" | "new" | "manage";

const items: Array<{
  key: TopicModulePage;
  label: string;
}> = [
    { key: "versions", label: "话题版本" },
    { key: "manage", label: "管理话题" },
  ];

export function TopicModuleNav({
  current,
  slug = "",
}: {
  current: TopicModulePage;
  slug?: string;
}) {
  function hrefFor(key: TopicModulePage): string {
    if (key === "versions") return topicsAdminPath(slug);
    if (key === "manage") return topicManageAdminPath(slug);
    return ADMIN_HREF.topicsNew;
  }

  return (
    <nav
      aria-label="话题管理子页面"
      className="flex flex-wrap gap-2 rounded-lg border bg-muted/20 p-2"
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={hrefFor(item.key)}
          aria-current={current === item.key ? "page" : undefined}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium transition-colors",
            current === item.key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
