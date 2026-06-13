import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { CONSOLE_PREFIX } from "@/lib/admin-web-paths";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/topics") {
    return NextResponse.redirect(new URL(`${CONSOLE_PREFIX}/topics`, request.url));
  }

  if (pathname === "/entities") {
    return NextResponse.redirect(new URL(`${CONSOLE_PREFIX}/entities`, request.url));
  }

  if (pathname.startsWith("/entities/rank-history")) {
    return NextResponse.redirect(new URL(`${CONSOLE_PREFIX}${pathname}`, request.url));
  }

  const adminOnlyExact = [
    "/seed",
    "/reindex",
    "/outbox",
    "/scale",
    "/ops",
    "/bi",
    "/agents",
    "/compliance",
    "/snapshots/compare",
  ] as const;

  if ((adminOnlyExact as readonly string[]).includes(pathname)) {
    return NextResponse.redirect(new URL(`${CONSOLE_PREFIX}${pathname}`, request.url));
  }

  if (pathname.startsWith("/rankings/") || pathname.startsWith("/crawl/")) {
    return NextResponse.redirect(new URL(`${CONSOLE_PREFIX}${pathname}`, request.url));
  }

  if (
    pathname.startsWith("/snapshots/") &&
    pathname !== "/snapshots/compare" &&
    request.nextUrl.searchParams.has("analysisKind")
  ) {
    return NextResponse.redirect(
      new URL(`${CONSOLE_PREFIX}${pathname}${request.nextUrl.search}`, request.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/topics",
    "/entities",
    "/entities/:path*",
    "/seed",
    "/reindex",
    "/outbox",
    "/scale",
    "/ops",
    "/bi",
    "/agents",
    "/compliance",
    "/rankings/:path*",
    "/crawl/:path*",
    "/snapshots/compare",
    "/snapshots/:id",
  ],
};
