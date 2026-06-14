import type { Metadata } from "next";
import Link from "next/link";

import { HotBoardCard, type HotBoardCardData } from "@/components/hot-board-card";
import { HotBoardFilters, HotBoardPagination } from "@/components/hot-board-filters";
import { SiteTimeWindowTabs } from "@/components/site-time-window-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { nestV1HotBoardsPath, nestV1TrendsHotPath } from "@/lib/nest-api-paths";
import { buildSiteMetadata } from "@/lib/site-metadata";
import { siteFetchJson } from "@/lib/site-api";
import {
  DEFAULT_TOPIC_SLUG,
  SITE_HREF,
  siteEntityPath,
  siteHotPath,
  siteTopicPath,
} from "@/lib/site-web-paths";

type HotTrendItem = {
  entityId: string;
  canonicalName: string;
  totalRankGain: number;
  topicSlugs: string[];
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ timeWindow?: string; topicQuery?: string }>;
}): Promise<Metadata> {
  const sp = (await searchParams) ?? {};
  const tw = sp.timeWindow?.trim();
  const q = sp.topicQuery?.trim();
  const title = q
    ? `热榜 · ${q}`
    : tw
      ? `热榜 · ${tw}`
      : "热榜";
  return buildSiteMetadata({
    title,
    description: "浏览各话题最新排行快照 TOP 预览，支持时间窗口与话题筛选。",
    path: "/hot",
  });
}

export default async function HotBoardsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    timeWindow?: string;
    topicsLimit?: string;
    offset?: string;
    topicQuery?: string;
    topicKind?: string;
  }>;
}) {
  const sp = (await searchParams) ?? {};
  const timeWindow = sp.timeWindow?.trim() ?? "";
  const topicQuery = sp.topicQuery?.trim() ?? "";
  const topicKind = sp.topicKind?.trim() ?? "";
  const topicsLimit = sp.topicsLimit?.trim() || "12";
  const offset = sp.offset?.trim() || "0";

  const q = new URLSearchParams();
  if (timeWindow) q.set("timeWindow", timeWindow);
  q.set("topicsLimit", topicsLimit);
  q.set("previewLimit", "5");
  q.set("offset", offset);
  if (topicQuery) q.set("topicQuery", topicQuery);
  if (topicKind) q.set("topicKind", topicKind);

  const hotQ = new URLSearchParams();
  if (timeWindow) hotQ.set("timeWindow", timeWindow);
  hotQ.set("limit", "10");

  const [boardsRes, hotRes] = await Promise.all([
    siteFetchJson<{
      boards?: HotBoardCardData[];
      count?: number;
      pagination?: {
        offset?: number;
        hasMore?: boolean;
        nextOffset?: number | null;
        totalMatching?: number;
      };
    }>(nestV1HotBoardsPath(q)),
    siteFetchJson<{ items?: HotTrendItem[] }>(nestV1TrendsHotPath(hotQ)),
  ]);

  const boards = boardsRes.ok && Array.isArray(boardsRes.data.boards)
    ? boardsRes.data.boards
    : [];
  const hotItems = hotRes.ok && Array.isArray(hotRes.data.items) ? hotRes.data.items : [];
  const pagination = boardsRes.ok ? boardsRes.data.pagination : undefined;

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">热榜</h1>
          <p className="max-w-2xl text-muted-foreground">
            只读浏览各话题最新排行快照。点击卡片查看完整榜单与历史快照。
          </p>
          {pagination?.totalMatching != null ? (
            <p className="text-xs text-muted-foreground">
              共 {pagination.totalMatching} 个话题匹配
              {topicQuery ? ` · 关键词「${topicQuery}」` : ""}
            </p>
          ) : null}
        </div>
        <HotBoardFilters
          topicQuery={topicQuery}
          topicKind={topicKind}
          timeWindow={timeWindow}
        />
        <SiteTimeWindowTabs
          active={timeWindow}
          hrefFor={(w) =>
            siteHotPath({
              ...(w ? { timeWindow: w } : {}),
              topicQuery: topicQuery || undefined,
              topicKind: topicKind || undefined,
              topicsLimit,
            })
          }
        />
      </header>

      {!boardsRes.ok ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            暂无法加载热榜（HTTP {boardsRes.status}）。请确认 API 已运行且已物化排行快照。
          </CardContent>
        </Card>
      ) : boards.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            暂无匹配话题。请调整筛选或运行演示数据。
          </CardContent>
        </Card>
      ) : (
        <>
          <section
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="话题热榜列表"
          >
            {boards.map((board) => (
              <HotBoardCard key={board.topic.slug} board={board} />
            ))}
          </section>
          <HotBoardPagination
            offset={pagination?.offset ?? Number(offset)}
            hasMore={Boolean(pagination?.hasMore)}
            nextOffset={pagination?.nextOffset ?? null}
            timeWindow={timeWindow}
            topicQuery={topicQuery}
            topicKind={topicKind}
            topicsLimit={topicsLimit}
          />
        </>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">涨榜速递</CardTitle>
            <CardDescription>
              跨话题名次上升实体 ·{" "}
              <Link href={SITE_HREF.trends} className="text-primary hover:underline">
                完整涨榜
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hotItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无涨榜数据。</p>
            ) : (
              <ul className="space-y-2">
                {hotItems.map((row, idx) => (
                  <li
                    key={row.entityId}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="w-5 text-xs text-muted-foreground">{idx + 1}</span>
                    <Link
                      href={siteEntityPath(row.entityId)}
                      className="font-medium hover:underline"
                    >
                      {row.canonicalName}
                    </Link>
                    <Badge variant="secondary">+{row.totalRankGain}</Badge>
                    <span className="ml-auto flex gap-1">
                      {row.topicSlugs.slice(0, 2).map((slug) => (
                        <Link
                          key={slug}
                          href={siteTopicPath(slug)}
                          className="text-xs text-primary hover:underline"
                        >
                          {slug}
                        </Link>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">快捷入口</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={siteTopicPath(DEFAULT_TOPIC_SLUG)}>演示话题完整榜</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={SITE_HREF.search}>搜索实体</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={SITE_HREF.trends}>热点涨榜</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/pricing">订阅方案</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
