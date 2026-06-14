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
import { EntityRankLineChart } from "@/components/entity-rank-line-chart";
import {
  nestV1EntityRankHistoryPath,
  nestV1EntityTimelinePath,
  nestV1RecommendationsSimilarEntitiesPath,
} from "@/lib/nest-api-paths";
import { buildSiteMetadata } from "@/lib/site-metadata";
import { siteFetchJson } from "@/lib/site-api";
import {
  DEFAULT_TOPIC_SLUG,
  siteEntityPath,
  siteTopicPath,
} from "@/lib/site-web-paths";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return buildSiteMetadata({
    title: `实体 #${id}`,
    description: "查看实体排名曲线、跨话题时间线与相似推荐。",
    path: `/entities/${id}`,
  });
}

export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ topicSlug?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const topicSlug = sp.topicSlug?.trim() || DEFAULT_TOPIC_SLUG;

  const historyQ = new URLSearchParams();
  historyQ.set("topicSlug", topicSlug);
  historyQ.set("timeWindow", "WEEK");
  historyQ.set("limit", "40");

  const historyRes = await siteFetchJson<{
    entity?: { id?: string; canonicalName?: string | null };
    topic?: { slug?: string; title?: string };
    points?: Array<{ asOf: string; rank: number }>;
    summary?: {
      bestRank?: number | null;
      worstRank?: number | null;
      endStreakRankImproving?: number | null;
      endStreakRankDeclining?: number | null;
    };
  }>(nestV1EntityRankHistoryPath(id, historyQ));

  const timelineQ = new URLSearchParams();
  timelineQ.set("topicSlugs", topicSlug);
  timelineQ.set("timeWindow", "WEEK");
  timelineQ.set("pointsLimit", "20");

  const timelineRes = await siteFetchJson<{
    events?: Array<{ type: string; at: string; label: string }>;
    metrics?: Array<{ metricKey: string; value: number; observedAt: string }>;
  }>(nestV1EntityTimelinePath(id, timelineQ));

  if (!historyRes.ok) notFound();

  const { entity, topic, points = [], summary } = historyRes.data;

  const similarRes = await siteFetchJson<{
    items?: Array<{ entityId: string; canonicalName: string; score?: number }>;
  }>(
    nestV1RecommendationsSimilarEntitiesPath(
      id,
      new URLSearchParams({ limit: "6" }),
    ),
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">实体 #{id}</p>
        <h1 className="text-3xl font-bold tracking-tight">
          {entity?.canonicalName ?? `实体 ${id}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          话题{" "}
          <Link href={siteTopicPath(topicSlug)} className="text-primary hover:underline">
            {topic?.title ?? topicSlug}
          </Link>
        </p>
      </header>

      {summary ? (
        <div className="flex flex-wrap gap-2">
          {summary.bestRank != null ? (
            <Badge variant="secondary">最佳 #{summary.bestRank}</Badge>
          ) : null}
          {summary.worstRank != null ? (
            <Badge variant="outline">最差 #{summary.worstRank}</Badge>
          ) : null}
          {(summary.endStreakRankImproving ?? 0) > 0 ? (
            <Badge variant="outline">连续上升 {summary.endStreakRankImproving} 步</Badge>
          ) : null}
          {(summary.endStreakRankDeclining ?? 0) > 0 ? (
            <Badge variant="outline">连续下降 {summary.endStreakRankDeclining} 步</Badge>
          ) : null}
        </div>
      ) : null}

      {points.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">名次曲线（近一周）</CardTitle>
            <CardDescription>数值越小排名越高</CardDescription>
          </CardHeader>
          <CardContent>
            <EntityRankLineChart
              points={points.map((p) => ({
                asOf: new Date(p.asOf).toLocaleDateString("zh-CN"),
                rank: p.rank,
              }))}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">暂无历史名次数据。</p>
      )}

      {timelineRes.ok && (timelineRes.data.events?.length || timelineRes.data.metrics?.length) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">时间线（名次 + 信号）</CardTitle>
            <CardDescription>只读预览 · 完整分析见运营台</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">
              {(timelineRes.data.events ?? []).slice(0, 15).map((ev, i) => (
                <li key={`${ev.at}-${i}`}>
                  <span className="text-muted-foreground">{ev.at.slice(0, 10)}</span>{" "}
                  {ev.label}
                </li>
              ))}
            </ul>
            {timelineRes.data.metrics && timelineRes.data.metrics.length > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                最新信号：{" "}
                {timelineRes.data.metrics
                  .slice(0, 3)
                  .map((m) => `${m.metricKey}=${m.value}`)
                  .join(" · ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {similarRes.ok && similarRes.data.items && similarRes.data.items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">相似实体</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {similarRes.data.items.map((row) => (
                <li key={row.entityId}>
                  <Link
                    href={siteEntityPath(row.entityId)}
                    className="inline-flex rounded-full border border-border px-3 py-1 text-sm hover:bg-muted"
                  >
                    {row.canonicalName}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
