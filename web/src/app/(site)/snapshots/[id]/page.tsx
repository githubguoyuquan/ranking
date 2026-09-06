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
import { nestV1SnapshotAnalysesPath, nestV1SnapshotPath } from "@/lib/nest-api-paths";
import { siteFetchJson } from "@/lib/site-api";
import { siteEntityPath, siteTopicPath } from "@/lib/site-web-paths";

type SnapshotPayload = {
  id?: string;
  snapshotVersion?: string;
  snapshotTime?: string;
  confidenceScore?: number;
  tTrendSummary?: string | null;
  items?: Array<{
    rank: number;
    rankChange?: number | null;
    popularityScore?: number;
    entity?: { id?: string; canonicalName?: string | null };
  }>;
  topicRanking?: {
    topicVersion?: {
      topic?: { title?: string; slug?: string };
    };
  };
};

type AnalysisItem = {
  id?: string;
  agent?: string;
  summary?: string | null;
  createdAt?: string;
};

export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const q = new URLSearchParams();

  const [snapRes, analysesRes] = await Promise.all([
    siteFetchJson<SnapshotPayload>(nestV1SnapshotPath(id, q)),
    siteFetchJson<{ analyses?: AnalysisItem[] }>(
      nestV1SnapshotAnalysesPath(id, new URLSearchParams({ limit: "5" })),
    ),
  ]);

  if (!snapRes.ok) notFound();

  const snap = snapRes.data;
  const topicSlug = snap.topicRanking?.topicVersion?.topic?.slug;
  const topicTitle = snap.topicRanking?.topicVersion?.topic?.title;
  const analyses = analysesRes.ok ? analysesRes.data.analyses ?? [] : [];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">快照 #{id}</p>
        <h1 className="text-[22px] font-bold tracking-tight sm:text-[28px]">
          {topicTitle ?? "排行榜快照"}
        </h1>
        {snap.snapshotTime ? (
          <p className="text-sm text-muted-foreground">
            {new Date(snap.snapshotTime).toLocaleString("zh-CN")}
            {snap.confidenceScore != null
              ? ` · 置信度 ${(snap.confidenceScore * 100).toFixed(0)}%`
              : null}
          </p>
        ) : null}
        {topicSlug ? (
          <Link
            href={siteTopicPath(topicSlug)}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            返回话题 {topicSlug}
          </Link>
        ) : null}
      </header>

      {snap.tTrendSummary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">趋势摘要</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{snap.tTrendSummary}</p>
          </CardContent>
        </Card>
      ) : null}

      {snap.items && snap.items.length > 0 ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">得分分布</CardTitle>
            </CardHeader>
            <CardContent>
              <SnapshotBarChart items={snap.items.slice(0, 20)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">完整榜单</CardTitle>
              <CardDescription>{snap.items.length} 个条目</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {snap.items.map((row) => (
                  <li
                    key={row.rank}
                    className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2"
                  >
                    <span className="w-8 text-center font-mono text-muted-foreground">
                      {row.rank}
                    </span>
                    {row.entity?.id ? (
                      <Link
                        href={siteEntityPath(String(row.entity.id))}
                        className="flex-1 font-medium hover:underline"
                      >
                        {row.entity.canonicalName ?? row.entity.id}
                      </Link>
                    ) : (
                      <span className="flex-1">{row.entity?.canonicalName ?? "—"}</span>
                    )}
                    {row.rankChange != null && row.rankChange !== 0 ? (
                      <Badge variant={row.rankChange < 0 ? "default" : "secondary"}>
                        {row.rankChange < 0
                          ? `↑${Math.abs(row.rankChange)}`
                          : `↓${row.rankChange}`}
                      </Badge>
                    ) : null}
                    {row.popularityScore != null ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {row.popularityScore.toFixed(2)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </>
      ) : null}

      {analyses.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI 简报</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {analyses.map((a) => (
              <article key={a.id ?? a.agent} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">{a.agent}</p>
                <p className="mt-1 text-sm leading-relaxed">{a.summary ?? "—"}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
