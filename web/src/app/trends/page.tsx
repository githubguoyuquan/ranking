"use client";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADMIN_HREF,
  entityRankHistoryAdminPath,
  topicsAdminPath,
} from "@/lib/admin-web-paths";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { NEST_V1_DOC } from "@/lib/nest-api-paths";
import { nestTrendsHotUrl } from "@/lib/nest-api-urls";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

type HotItem = {
  entityId: string;
  canonicalName: string;
  totalRankGain: number;
  mentions: number;
  topicSlugs: string[];
};

function TrendsPageInner() {
  const { abs } = useAdminAppUrl();
  const router = useRouter();
  const sp = useSearchParams();
  const [timeWindow, setTimeWindow] = useState(
    sp.get("timeWindow")?.trim() ?? "",
  );
  const [limit, setLimit] = useState(sp.get("limit")?.trim() ?? "15");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState<HotItem[]>([]);
  const [sourceNote, setSourceNote] = useState("");

  const apiUrl = useMemo(() => {
    const q = new URLSearchParams();
    if (timeWindow.trim()) q.set("timeWindow", timeWindow.trim());
    if (limit.trim()) q.set("limit", limit.trim());
    return nestTrendsHotUrl(q);
  }, [timeWindow, limit]);

  useEffect(() => {
    const tw = sp.get("timeWindow")?.trim() ?? "";
    const l = sp.get("limit")?.trim() ?? "15";
    setTimeWindow(tw);
    setLimit(l);

    const q = new URLSearchParams();
    if (tw) q.set("timeWindow", tw);
    if (l) q.set("limit", l);
    const url = nestTrendsHotUrl(q);

    let cancelled = false;
    setLoading(true);
    setErr("");
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text();
        if (cancelled) return;
        if (!res.ok) {
          setErr(`HTTP ${res.status}\n${text}`);
          setItems([]);
          setSourceNote("");
          return;
        }
        const j = JSON.parse(text) as {
          items?: HotItem[];
          source?: { note?: string; analysesScanned?: number };
        };
        setSourceNote(
          j.source?.note
            ? `${j.source.note}（扫描 ${String(j.source.analysesScanned ?? "?")} 条 TrendAnalysis）`
            : "",
        );
        setItems(Array.isArray(j.items) ? j.items : []);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setItems([]);
          setSourceNote("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sp]);

  function applyQuery() {
    const q = new URLSearchParams();
    if (timeWindow.trim()) q.set("timeWindow", timeWindow.trim());
    if (limit.trim()) q.set("limit", limit.trim());
    const qs = q.toString();
    router.replace(qs ? `${ADMIN_HREF.trends}?${qs}` : ADMIN_HREF.trends, {
      scroll: false,
    });
  }

  return (
    <div className="w-full max-w-none space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">热点名次（演示）</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.trendsHot}</code>
          — 自近期快照级 <code className="text-xs">TrendAnalysis</code> 的{" "}
          <code className="text-xs">topRankGainers</code> 聚合涨名次
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">筛选</CardTitle>
          <CardDescription>
            可选 <code className="text-xs">timeWindow</code>；<code className="text-xs">limit</code>{" "}
            1–50（默认 15）。修改后点「写入地址栏」从服务端拉取。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="trends-tw">timeWindow</Label>
            <Input
              id="trends-tw"
              maxLength={16}
              placeholder="WEEK（可空）"
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value)}
            />
          </div>
          <div className="w-full space-y-2 sm:w-28">
            <Label htmlFor="trends-limit">limit</Label>
            <Input
              id="trends-limit"
              inputMode="numeric"
              maxLength={3}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
          <Button type="button" disabled={loading} onClick={() => applyQuery()}>
            {loading ? "加载中…" : "写入地址栏并加载"}
          </Button>
        </CardContent>
      </Card>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <CopyTextButton text={apiUrl} idleLabel="复制 API URL（表单）" className="h-6" />
        <a
          href={apiUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          新标签 JSON
        </a>
        <CopyTextButton
          text={abs(
            (() => {
              const q = new URLSearchParams();
              if (timeWindow.trim()) q.set("timeWindow", timeWindow.trim());
              if (limit.trim()) q.set("limit", limit.trim());
              const qs = q.toString();
              return qs ? `${ADMIN_HREF.trends}?${qs}` : ADMIN_HREF.trends;
            })(),
          )}
          idleLabel="复制本页路径"
          className="h-6"
        />
      </p>

      {sourceNote ? (
        <p className="text-xs text-muted-foreground">{sourceNote}</p>
      ) : null}

      {err ? (
        <pre className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap">
          {err}
        </pre>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  实体
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Σ涨名次
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  命中
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  话题
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const primarySlug = row.topicSlugs[0] ?? "global-female-singers";
                return (
                  <tr key={row.entityId} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="px-3 py-2 font-normal">
                      <span className="font-medium">{row.canonicalName}</span>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        id {row.entityId}
                      </div>
                    </th>
                    <td className="px-3 py-2">{row.totalRankGain}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.mentions}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        {row.topicSlugs.slice(0, 3).map((s) => (
                          <Link
                            key={s}
                            href={topicsAdminPath(s)}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {s}
                          </Link>
                        ))}
                        <Link
                          href={entityRankHistoryAdminPath(row.entityId, primarySlug)}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                        >
                          名次曲线
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !loading && !err ? (
        <p className="text-sm text-muted-foreground">暂无数据（先 seed-demo 并跑榜生成 TrendAnalysis）。</p>
      ) : null}

      <AdminFooterNav />
    </div>
  );
}

export default function TrendsPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-none p-6 text-sm text-muted-foreground">加载…</div>
      }
    >
      <TrendsPageInner />
    </Suspense>
  );
}
