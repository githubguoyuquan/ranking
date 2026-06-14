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
import {
  nestV1TopicLeaderboardPath,
  nestV1TopicPath,
  nestV1TopicSnapshotsPath,
} from "@/lib/nest-api-paths";
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
  if (!q.has("includeAiStats")) q.set("includeAiStats", "1");

  const [topicRes, lbRes] = await Promise.all([
    siteFetchJson<{
      title?: string;
      slug?: string;
      kind?: string;
      kindStrategy?: { description?: string };
    }>(nestV1TopicPath(slug)),
    siteFetchJson<{
      resolved?: {
        topicTitle?: string;
        timeWindow?: string;
        topicVersion?: string;
      };
      snapshot?: {
        id?: string;
        snapshotTime?: string;
        confidenceScore?: number;
        items?: LeaderboardItem[];
      };
    }>(nestV1TopicLeaderboardPath(slug, q)),
  ]);

  if (!topicRes.ok && !lbRes.ok) notFound();

  const topic = topicRes.ok ? topicRes.data : null;
  const snapshot = lbRes.ok ? lbRes.data.snapshot : undefined;
  const resolved = lbRes.ok ? lbRes.data.resolved : undefined;
  const title = topic?.title ?? resolved?.topicTitle ?? slug;

  const recentSnaps = await siteFetchJson<{
    snapshots?: Array<{ id: string; snapshotTime?: string }>;
  }>(nestV1TopicSnapshotsPath(slug, new URLSearchParams({ limit: "5" })));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">{slug}</p>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
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
            <p className="text-sm text-muted-foreground">该话题尚无排行快照。</p>
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
