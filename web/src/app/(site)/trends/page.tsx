"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { nestTrendsHotUrl } from "@/lib/nest-api-urls";
import { siteApiHeaders } from "@/lib/site-api";
import { siteEntityPath, siteTopicPath, siteTrendsPath } from "@/lib/site-web-paths";

type HotItem = {
  entityId: string;
  canonicalName: string;
  totalRankGain: number;
  mentions: number;
  topicSlugs: string[];
};

function TrendsPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [timeWindow, setTimeWindow] = useState(sp.get("timeWindow")?.trim() ?? "");
  const [limit, setLimit] = useState(sp.get("limit")?.trim() ?? "20");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<HotItem[]>([]);
  const [note, setNote] = useState("");

  const apiPath = useMemo(() => {
    const q = new URLSearchParams();
    if (timeWindow.trim()) q.set("timeWindow", timeWindow.trim());
    if (limit.trim()) q.set("limit", limit.trim());
    return nestTrendsHotUrl(q);
  }, [timeWindow, limit]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(apiPath, {
          headers: siteApiHeaders(),
          cache: "no-store",
        });
        const text = await res.text();
        if (cancelled) return;
        if (!res.ok) {
          setItems([]);
          setNote(`加载失败 HTTP ${res.status}`);
          return;
        }
        const j = JSON.parse(text) as {
          items?: HotItem[];
          source?: { note?: string };
        };
        setItems(Array.isArray(j.items) ? j.items : []);
        setNote(j.source?.note ?? "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiPath]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">热点涨榜</h1>
        <p className="text-muted-foreground">
          汇总近期快照中的名次上升实体，发现跨话题待势条目。
        </p>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(siteTrendsPath({ timeWindow, limit }));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="tw">时间窗口</Label>
          <Input
            id="tw"
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value)}
            placeholder="WEEK（可选）"
            className="w-36"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lim">条数</Label>
          <Input
            id="lim"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-24"
          />
        </div>
        <Button type="submit">刷新</Button>
      </form>

      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">涨榜实体</CardTitle>
          <CardDescription>{loading ? "加载中…" : `共 ${items.length} 条`}</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">暂无数据。</p>
          ) : (
            <ul className="space-y-3">
              {items.map((row, idx) => (
                <li
                  key={row.entityId}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2.5"
                >
                  <span className="w-6 text-sm text-muted-foreground">{idx + 1}</span>
                  <Link
                    href={siteEntityPath(row.entityId)}
                    className="font-medium hover:underline"
                  >
                    {row.canonicalName}
                  </Link>
                  <Badge variant="secondary">+{row.totalRankGain}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {row.mentions} 次提及
                  </span>
                  <span className="ml-auto flex flex-wrap gap-1">
                    {row.topicSlugs.slice(0, 3).map((slug) => (
                      <Link
                        key={slug}
                        href={siteTopicPath(slug)}
                        className="text-xs text-primary underline-offset-2 hover:underline"
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
    </div>
  );
}

export default function TrendsPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">加载中…</p>}>
      <TrendsPageInner />
    </Suspense>
  );
}
