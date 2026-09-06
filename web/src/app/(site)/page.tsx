import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { nestV1TopicLeaderboardPath, nestV1TopicPath, nestV1TrendsHotPath } from "@/lib/nest-api-paths";
import { buildSiteMetadata } from "@/lib/site-metadata";
import { siteFetchJson } from "@/lib/site-api";
import { SiteDevicePersonalization } from "@/components/site-device-personalization";
import {
  DEFAULT_TOPIC_SLUG,
  SITE_HREF,
  siteEntityPath,
  siteSnapshotPath,
  siteTopicPath,
} from "@/lib/site-web-paths";

type HotItem = {
  entityId: string;
  canonicalName: string;
  totalRankGain: number;
  mentions: number;
  topicSlugs: string[];
};

type LeaderboardItem = {
  rank: number;
  rankChange?: number | null;
  popularityScore?: number;
  entity?: { id?: string; canonicalName?: string | null };
};

export const metadata: Metadata = buildSiteMetadata({
  title: "首页",
  description: "AI 驱动的全球动态排行榜 — 热榜、涨榜、搜索与实体排名演化。",
  path: "/",
});

export default async function HomePage() {
  const [hotRes, lbRes, topicRes] = await Promise.all([
    siteFetchJson<{ items?: HotItem[] }>(
      nestV1TrendsHotPath(new URLSearchParams({ limit: "8" })),
    ),
    siteFetchJson<{
      resolved?: { topicTitle?: string; topicSlug?: string };
      snapshot?: {
        id?: string;
        snapshotTime?: string;
        items?: LeaderboardItem[];
      };
    }>(nestV1TopicLeaderboardPath(DEFAULT_TOPIC_SLUG)),
    siteFetchJson<{ title?: string; slug?: string; kind?: string }>(
      nestV1TopicPath(DEFAULT_TOPIC_SLUG),
    ),
  ]);

  const hotItems = hotRes.ok && Array.isArray(hotRes.data.items) ? hotRes.data.items : [];
  const snapshot = lbRes.ok ? lbRes.data.snapshot : undefined;
  const topicTitle =
    (topicRes.ok && topicRes.data.title) ||
    (lbRes.ok && lbRes.data.resolved?.topicTitle) ||
    "演示榜单";

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[32px]">
          动态排行榜
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          浏览话题热榜、实体排名变化与 AI 趋势洞察。数据来自 Ranking 平台实时物化快照。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={SITE_HREF.hot}>浏览热榜</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={siteTopicPath(DEFAULT_TOPIC_SLUG)}>查看 {topicTitle}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={SITE_HREF.trends}>涨榜速递</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={SITE_HREF.search}>搜索实体</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{topicTitle}</CardTitle>
            <CardDescription>
              最新 TOP 10 ·{" "}
              <Link
                href={siteTopicPath(DEFAULT_TOPIC_SLUG)}
                className="text-primary underline-offset-4 hover:underline"
              >
                完整榜单
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!lbRes.ok ? (
              <p className="text-sm text-muted-foreground">
                暂无榜单数据。请先在运营台运行排行或加载演示数据。
              </p>
            ) : (
              <ol className="space-y-2">
                {(snapshot?.items ?? []).slice(0, 10).map((row) => (
                  <li
                    key={`${row.rank}-${row.entity?.id ?? row.entity?.canonicalName}`}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="w-6 text-center font-mono text-sm text-muted-foreground">
                      {row.rank}
                    </span>
                    {row.entity?.id ? (
                      <Link
                        href={siteEntityPath(String(row.entity.id))}
                        className="min-w-0 flex-1 truncate font-medium hover:underline"
                      >
                        {row.entity.canonicalName ?? `实体 ${row.entity.id}`}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">
                        {row.entity?.canonicalName ?? "—"}
                      </span>
                    )}
                    {row.rankChange != null && row.rankChange !== 0 ? (
                      <Badge variant={row.rankChange < 0 ? "default" : "secondary"}>
                        {row.rankChange < 0 ? `↑${Math.abs(row.rankChange)}` : `↓${row.rankChange}`}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            {snapshot?.id ? (
              <p className="mt-3 text-xs text-muted-foreground">
                快照{" "}
                <Link
                  href={siteSnapshotPath(String(snapshot.id))}
                  className="underline underline-offset-2"
                >
                  #{snapshot.id}
                </Link>
                {snapshot.snapshotTime
                  ? ` · ${new Date(snapshot.snapshotTime).toLocaleString("zh-CN")}`
                  : null}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">热点涨榜</CardTitle>
            <CardDescription>
              近期待势实体 ·{" "}
              <Link
                href={SITE_HREF.hot}
                className="text-primary underline-offset-4 hover:underline"
              >
                热榜
              </Link>
              {" · "}
              <Link
                href={SITE_HREF.trends}
                className="text-primary underline-offset-4 hover:underline"
              >
                涨榜
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!hotRes.ok || hotItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无热点数据。</p>
            ) : (
              <ul className="space-y-2">
                {hotItems.map((row) => (
                  <li
                    key={row.entityId}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <Link
                      href={siteEntityPath(row.entityId)}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {row.canonicalName}
                    </Link>
                    <Badge variant="secondary">+{row.totalRankGain}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <SiteDevicePersonalization />
    </div>
  );
}
