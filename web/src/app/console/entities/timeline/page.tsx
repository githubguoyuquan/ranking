"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { AdminPage } from "@/components/admin-page";
import { EntityMultiTopicRankChart } from "@/components/entity-multi-topic-rank-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import { isDecimalBigIntIdString } from "@/lib/decimal-id";
import { NEST_V1_DOC } from "@/lib/nest-api-paths";
import { nestEntityTimelineUrl } from "@/lib/nest-api-urls";

type TimelineEvent = {
  type: string;
  at: string;
  topicSlug?: string;
  label: string;
};

function TimelinePageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [entityId, setEntityId] = useState(sp.get("entityId")?.trim() ?? "");
  const [topicSlugs, setTopicSlugs] = useState(sp.get("topicSlugs")?.trim() ?? "");
  const [timeWindow, setTimeWindow] = useState(sp.get("timeWindow")?.trim() ?? "");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<{
    entity?: { canonicalName?: string };
    topicSeries?: Array<{
      topicSlug: string;
      topicTitle: string;
      summary?: Record<string, unknown> | null;
      points: Array<{ asOf: string; rank: number }>;
    }>;
    events?: TimelineEvent[];
    metrics?: Array<{ metricKey: string; value: number; observedAt: string }>;
  } | null>(null);

  const chartSeries = useMemo(
    () =>
      (data?.topicSeries ?? []).map((s) => ({
        topicSlug: s.topicSlug,
        points: s.points.map((p) => ({ asOf: p.asOf, rank: p.rank })),
      })),
    [data],
  );

  useEffect(() => {
    const id = sp.get("entityId")?.trim() ?? "";
    if (!id || !isDecimalBigIntIdString(id)) return;

    const q = new URLSearchParams();
    const slugs = sp.get("topicSlugs")?.trim();
    const tw = sp.get("timeWindow")?.trim();
    if (slugs) q.set("topicSlugs", slugs);
    if (tw) q.set("timeWindow", tw);

    let cancelled = false;
    setLoading(true);
    setErr("");
    (async () => {
      try {
        const res = await fetch(nestEntityTimelineUrl(id, q), { cache: "no-store" });
        const text = await res.text();
        if (cancelled) return;
        if (!res.ok) {
          setErr(`HTTP ${res.status}\n${text}`);
          setData(null);
          return;
        }
        setData(JSON.parse(text) as typeof data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sp]);

  function loadFromForm() {
    const id = entityId.trim();
    if (!isDecimalBigIntIdString(id)) {
      setErr("entityId 须为十进制主键");
      return;
    }
    const q = new URLSearchParams({ entityId: id });
    if (topicSlugs.trim()) q.set("topicSlugs", topicSlugs.trim());
    if (timeWindow.trim()) q.set("timeWindow", timeWindow.trim());
    router.replace(`${ADMIN_HREF.entityTimeline}?${q.toString()}`);
  }

  return (
    <AdminPage
      title="实体运营时间线"
      description={`多话题名次叠加 + 信号事件。API：${NEST_V1_DOC.entityTimeline}`}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">查询</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="entityId">entityId</Label>
            <Input id="entityId" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="topicSlugs">topicSlugs（逗号分隔，可选）</Label>
            <Input id="topicSlugs" value={topicSlugs} onChange={(e) => setTopicSlugs(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="timeWindow">timeWindow（可选）</Label>
            <Input id="timeWindow" value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)} placeholder="WEEK" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" onClick={loadFromForm} disabled={loading}>
              {loading ? "加载中…" : "加载"}
            </Button>
            <Link href={ADMIN_HREF.entityRankHistory} className="text-sm text-primary underline-offset-4 hover:underline">
              单话题曲线
            </Link>
          </div>
        </CardContent>
      </Card>

      {data?.entity?.canonicalName && (
        <p className="text-sm text-muted-foreground">
          {data.entity.canonicalName} · {data.topicSeries?.length ?? 0} 话题序列
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">多话题名次</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityMultiTopicRankChart series={chartSeries} />
        </CardContent>
      </Card>

      {data?.events && data.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">事件流（名次 + 信号）</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="max-h-80 space-y-1 overflow-auto text-sm">
              {data.events.slice(0, 80).map((ev, i) => (
                <li key={`${ev.at}-${i}`}>
                  <span className="text-muted-foreground">{ev.at.slice(0, 19)}</span>{" "}
                  <span className="font-medium">[{ev.type}]</span> {ev.label}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {err && (
        <pre className="overflow-auto rounded bg-destructive/10 p-3 text-xs text-destructive">{err}</pre>
      )}

      <AdminFooterNav />
    </AdminPage>
  );
}

export default function EntityTimelinePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">加载…</p>}>
      <TimelinePageInner />
    </Suspense>
  );
}
