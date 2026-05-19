"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_NAV_ITEMS, isAdminNavActive } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

export function AdminSidebarNav({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("pb-1", className)} aria-label="主要页面">
      <ul className="flex flex-col gap-0.5">
        {ADMIN_NAV_ITEMS.map((item) => {
          const active = isAdminNavActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "block rounded-md px-3 py-2.5 text-base transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
