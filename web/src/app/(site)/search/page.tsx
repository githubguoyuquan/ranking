"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiUrl } from "@/lib/api";
import { NEST_V1 } from "@/lib/nest-api-paths";
import { siteApiHeaders } from "@/lib/site-api";
import { siteEntityPath, siteSearchPath } from "@/lib/site-web-paths";

type SearchHit = {
  entityId?: string;
  canonicalName?: string;
  score?: number;
  source?: string;
};

function SearchPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const qInit = sp.get("q")?.trim() ?? "";
  const [q, setQ] = useState(qInit);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  const runSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setErr("");
      return;
    }
    setLoading(true);
    setErr("");
    const params = new URLSearchParams({ q: trimmed, limit: "20" });
    try {
      const res = await fetch(apiUrl(`${NEST_V1.search}?${params}`), {
        headers: siteApiHeaders(),
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) {
        setErr(`HTTP ${res.status}`);
        setHits([]);
        return;
      }
      const j = JSON.parse(text) as {
        entities?: { hits?: SearchHit[] };
        results?: SearchHit[];
      };
      const list =
        j.entities?.hits ??
        (Array.isArray(j.results) ? j.results : []);
      setHits(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setQ(qInit);
    if (qInit) void runSearch(qInit);
  }, [qInit, runSearch]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-[28px] font-bold tracking-tight">搜索</h1>
        <p className="text-muted-foreground">在全平台实体索引中查找人物、品牌或话题相关条目。</p>
      </header>

      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = q.trim();
          router.push(siteSearchPath(trimmed));
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="site-search-q">关键词</Label>
          <Input
            id="site-search-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入实体名称…"
            maxLength={200}
          />
        </div>
        <Button type="submit" disabled={loading || !q.trim()}>
          {loading ? "搜索中…" : "搜索"}
        </Button>
      </form>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}

      {hits.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">结果 ({hits.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {hits.map((hit, i) => (
                <li key={hit.entityId ?? i} className="flex items-center gap-3 py-3">
                  {hit.entityId ? (
                    <Link
                      href={siteEntityPath(hit.entityId)}
                      className="font-medium hover:underline"
                    >
                      {hit.canonicalName ?? hit.entityId}
                    </Link>
                  ) : (
                    <span>{hit.canonicalName ?? "—"}</span>
                  )}
                  {hit.score != null ? (
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {hit.score.toFixed(3)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : qInit && !loading && !err ? (
        <p className="text-sm text-muted-foreground">未找到匹配实体。</p>
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">加载中…</p>}>
      <SearchPageInner />
    </Suspense>
  );
}
