import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SnapshotBarChart } from "@/components/snapshot-bar-chart";
import { getApiBase } from "@/lib/api";
import Link from "next/link";
import { notFound } from "next/navigation";

type SnapshotPayload = {
  id?: string;
  snapshotVersion?: string;
  snapshotTime?: string;
  confidenceScore?: number;
  items?: Array<{
    rank: number;
    previousRank?: number | null;
    rankChange?: number | null;
    popularityScore?: number;
    entity?: { canonicalName?: string | null };
  }>;
  topicRanking?: {
    topicVersion?: { version?: string; topic?: { title?: string; slug?: string } };
  };
};

export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await fetch(`${getApiBase()}/v1/snapshots/${id}`, {
    cache: "no-store",
  });
  if (res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-destructive">
          加载失败 HTTP {res.status}，请确认 API 与 snapshot id。
        </p>
        <Link href="/" className="mt-4 block text-primary underline-offset-4 hover:underline">
          ← 返回概览
        </Link>
      </div>
    );
  }
  const data = (await res.json()) as SnapshotPayload;
  const title =
    data.topicRanking?.topicVersion?.topic?.title ?? "排行榜快照";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            id <code className="rounded bg-muted px-1 text-xs">{data.id}</code>
            {data.snapshotVersion ? (
              <>
                {" "}
                · {data.snapshotVersion}
              </>
            ) : null}
            {data.snapshotTime ? (
              <>
                {" "}
                · {data.snapshotTime}
              </>
            ) : null}
          </p>
        </div>
        <Link
          href="/rankings/run"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          再跑一轮 →
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">得分分布（ECharts）</CardTitle>
          <CardDescription>
            横轴为 popularityScore（归一化），纵轴为实体名称 · 置信度{" "}
            {data.confidenceScore != null
              ? data.confidenceScore.toFixed(3)
              : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SnapshotBarChart items={data.items ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">原始条目</CardTitle>
          <CardDescription>含 rank / rankChange</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">实体</th>
                  <th className="px-3 py-2 font-medium">分数</th>
                  <th className="px-3 py-2 font-medium">上次</th>
                  <th className="px-3 py-2 font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {(data.items ?? [])
                  .slice()
                  .sort((a, b) => a.rank - b.rank)
                  .map((row) => (
                    <tr key={row.rank} className="border-b border-border/60">
                      <td className="px-3 py-2">{row.rank}</td>
                      <td className="px-3 py-2">
                        {row.entity?.canonicalName ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.popularityScore?.toFixed(4) ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.previousRank ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.rankChange ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
        ← 返回概览
      </Link>
    </div>
  );
}
