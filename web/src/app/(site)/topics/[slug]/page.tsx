import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SnapshotBarChart } from "@/components/snapshot-bar-chart";
import { TopicTimeWindowTabs } from "@/components/topic-time-window-tabs";
import { nestV1TopicOverviewPath } from "@/lib/nest-api-paths";
import { buildSiteMetadata } from "@/lib/site-metadata";
import { siteFetchJson } from "@/lib/site-api";
import { siteEntityPath, siteSnapshotPath } from "@/lib/site-web-paths";

type LeaderboardItem = {
  rank: number;
  rankChange?: number | null;
  popularityScore?: number;
  entity?: { id?: string; canonicalName?: string | null };
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return buildSiteMetadata({
    title: slug,
    description: `查看话题「${slug}」最新排行榜、快照与得分分布。`,
    path: `/topics/${slug}`,
  });
}

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ timeWindow?: string; version?: string }>;
}) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const q = new URLSearchParams();
  if (sp.timeWindow?.trim()) q.set("timeWindow", sp.timeWindow.trim());
  if (sp.version?.trim()) q.set("version", sp.version.trim());
  const overview = await siteFetchJson<{
    topic: { title: string; slug: string; kindStrategy?: { description?: string } };
    leaderboard: { status: string; data: { resolved: { timeWindow?: string }; snapshot?: { id?: string; snapshotTime?: string; items?: LeaderboardItem[] } } | null };
    recentSnapshots: { status: string; data: Array<{ id: string; snapshotTime?: string }> | null };
  }>(nestV1TopicOverviewPath(slug, q));
  if (!overview.ok) {
    if (overview.status === 404) notFound();
    return <p role="alert">话题加载失败，请稍后重试。</p>;
  }
  const { topic, leaderboard, recentSnapshots } = overview.data;
  const snapshot = leaderboard.data?.snapshot;
  const resolved = leaderboard.data?.resolved;
  const title = topic.title;
  const recentSnaps = { ok: recentSnapshots.status !== "unavailable", data: { snapshots: recentSnapshots.data ?? [] } };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">{slug}</p>
        <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
        {topic?.kindStrategy?.description ? (
          <p className="text-muted-foreground">{topic.kindStrategy.description}</p>
        ) : null}
        {resolved?.timeWindow ? (
          <Badge variant="outline">窗口 {resolved.timeWindow}</Badge>
        ) : null}
        <TopicTimeWindowTabs slug={slug} active={sp.timeWindow} />
      </header>

      {snapshot?.items && snapshot.items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">得分分布</CardTitle>
          </CardHeader>
          <CardContent>
            <SnapshotBarChart items={snapshot.items.slice(0, 15)} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">排行榜</CardTitle>
          <CardDescription>
            {snapshot?.snapshotTime
              ? `更新于 ${new Date(snapshot.snapshotTime).toLocaleString("zh-CN")}`
              : "暂无快照"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!snapshot?.items?.length ? (
            <p className="text-sm text-muted-foreground">{leaderboard.status === "unavailable" ? "排行榜暂时无法加载，请稍后重试。" : "该话题尚无排行快照。"}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-3" scope="col">
                      名次
                    </th>
                    <th className="pb-2 pr-3" scope="col">
                      实体
                    </th>
                    <th className="pb-2 pr-3" scope="col">
                      变化
                    </th>
                    <th className="pb-2" scope="col">
                      得分
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.items.map((row) => (
                    <tr key={row.rank} className="border-b border-border/60">
                      <th className="py-2.5 pr-3 font-normal" scope="row">
                        {row.rank}
                      </th>
                      <td className="py-2.5 pr-3">
                        {row.entity?.id ? (
                          <Link
                            href={siteEntityPath(String(row.entity.id))}
                            className="font-medium hover:underline"
                          >
                            {row.entity.canonicalName ?? row.entity.id}
                          </Link>
                        ) : (
                          row.entity?.canonicalName ?? "—"
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {row.rankChange == null || row.rankChange === 0
                          ? "—"
                          : row.rankChange < 0
                            ? `↑${Math.abs(row.rankChange)}`
                            : `↓${row.rankChange}`}
                      </td>
                      <td className="py-2.5 tabular-nums">
                        {row.popularityScore != null
                          ? row.popularityScore.toFixed(2)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {snapshot?.id ? (
            <p className="mt-4 text-xs text-muted-foreground">
              <Link
                href={siteSnapshotPath(String(snapshot.id))}
                className="underline underline-offset-2"
              >
                查看快照详情 #{snapshot.id}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {recentSnapshots.status === "unavailable" ? <p role="alert">近期快照暂时无法加载。</p> : null}
      {recentSnaps.ok && recentSnaps.data.snapshots && recentSnaps.data.snapshots.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">近期快照</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {recentSnaps.data.snapshots.map((s) => (
                <li key={s.id}>
                  <Link
                    href={siteSnapshotPath(s.id)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    #{s.id}
                  </Link>
                  {s.snapshotTime
                    ? ` · ${new Date(s.snapshotTime).toLocaleString("zh-CN")}`
                    : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
