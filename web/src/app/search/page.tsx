"use client";

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
import { getApiBase } from "@/lib/api";
import { useEffect, useState } from "react";

type SearchEsHealth = {
  ok: boolean;
  clusterName?: string;
  detail?: string;
};

type UnifiedSearchResponse = {
  query: string;
  entities: {
    source: string;
    hits: Array<{
      entityId: string;
      score: number;
      canonicalName: string;
      type: string;
      highlights?: Record<string, string[]>;
    }>;
    detail?: string;
    error?: string;
  };
  crawledUrls: {
    source: string;
    hits: unknown[];
    note?: string;
    detail?: string;
    error?: string;
  };
};

type EsCrawledHit = {
  crawledUrlId: string;
  score: number;
  url: string;
  sourceId: string;
  mimeType: string | null;
  status: string;
  snippet: string;
  highlights?: Record<string, string[]>;
};

type PgCrawledRow = {
  id: string | number | bigint;
  sourceId: string | number | bigint;
  url: string;
  mimeType: string | null;
  textPreview: string | null;
  status: string;
  source?: {
    id: string | number | bigint;
    name: string;
    baseUrl: string;
    kind: string;
  };
};

function isEsCrawledHit(x: unknown): x is EsCrawledHit {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.crawledUrlId === "string" && "snippet" in o;
}

function isPgCrawledRow(x: unknown): x is PgCrawledRow {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return "urlFingerprint" in o || ("id" in o && !("crawledUrlId" in o));
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Elasticsearch 高亮 HTML（&lt;em&gt;），来自服务端 */
function HighlightedHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <span
      className={
        className ??
        "[&_em]:rounded-md [&_em]:bg-amber-500/20 [&_em]:px-0.5 [&_em]:not-italic"
      }
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function SearchPage() {
  const [q, setQ] = useState("Swift");
  const [limit, setLimit] = useState("12");
  const [crawlIndex, setCrawlIndex] = useState<"auto" | "es" | "pg">("auto");
  const [entityIndex, setEntityIndex] = useState<"auto" | "es" | "pg">("auto");
  const [sourceId, setSourceId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UnifiedSearchResponse | null>(null);
  const [rawError, setRawError] = useState<string>("");
  const [esHealth, setEsHealth] = useState<SearchEsHealth | null>(null);
  const [esHealthErr, setEsHealthErr] = useState<string>("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${getApiBase()}/v1/search/health`, {
          cache: "no-store",
        });
        const text = await res.text();
        if (!res.ok) {
          setEsHealth(null);
          setEsHealthErr(`HTTP ${res.status}: ${text}`);
          return;
        }
        setEsHealthErr("");
        setEsHealth(JSON.parse(text) as SearchEsHealth);
      } catch (e) {
        setEsHealth(null);
        setEsHealthErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function runSearch() {
    setLoading(true);
    setResult(null);
    setRawError("");
    try {
      const params = new URLSearchParams({
        q: q.trim(),
        limit: limit.trim() || "12",
        crawlIndex,
        entityIndex,
      });
      const sid = sourceId.trim();
      const st = status.trim();
      if (sid) params.set("sourceId", sid);
      if (st) params.set("status", st);

      const res = await fetch(
        `${getApiBase()}/v1/search?${params.toString()}`,
        { cache: "no-store" },
      );
      const text = await res.text();
      if (!res.ok) {
        setRawError(`HTTP ${res.status}\n${text}`);
        return;
      }
      setResult(JSON.parse(text) as UnifiedSearchResponse);
    } catch (e) {
      setRawError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">搜索</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">GET /v1/search</code>
          ：实体（
          <code className="rounded bg-muted px-1">entityIndex</code>）与爬取（
          <code className="rounded bg-muted px-1">crawlIndex</code>）；未配 ES 时
          实体走 PostgreSQL（<code className="rounded bg-muted px-1">canonicalName</code>{" "}
          <code className="rounded bg-muted px-1">aliases</code> 子串）。ES 命中含{" "}
          <code className="rounded bg-muted px-1">&lt;em&gt;</code>{" "}
          高亮片段。爬取仍按原规则。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Elasticsearch{" "}
          <code className="rounded bg-muted px-1">GET /v1/search/health</code>
          ：
          {esHealthErr ? (
            <span className="text-destructive"> {esHealthErr}</span>
          ) : esHealth ? (
            <>
              {" "}
              <span className={esHealth.ok ? "text-green-700" : "text-amber-700"}>
                {esHealth.ok ? "可达" : "不可用"}
              </span>
              {esHealth.clusterName
                ? `（${esHealth.clusterName}）`
                : esHealth.detail
                  ? ` — ${esHealth.detail}`
                  : ""}
            </>
          ) : (
            " …"
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">查询</CardTitle>
          <CardDescription>
            实体默认 auto：有 <code className="text-xs">ELASTICSEARCH_NODE</code>{" "}
            用 ES，否则用 PG；也可用 entityIndex 强制。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="q">q</Label>
              <Input
                id="q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit">limit</Label>
              <Input
                id="limit"
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entityIndex">entityIndex</Label>
              <select
                id="entityIndex"
                className={selectClass}
                value={entityIndex}
                onChange={(e) =>
                  setEntityIndex(e.target.value as "auto" | "es" | "pg")
                }
              >
                <option value="auto">auto</option>
                <option value="es">es</option>
                <option value="pg">pg</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="crawlIndex">crawlIndex</Label>
              <select
                id="crawlIndex"
                className={selectClass}
                value={crawlIndex}
                onChange={(e) =>
                  setCrawlIndex(e.target.value as "auto" | "es" | "pg")
                }
              >
                <option value="auto">auto（有 ES 走索引）</option>
                <option value="es">es</option>
                <option value="pg">pg</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sourceId">sourceId（可选）</Label>
              <Input
                id="sourceId"
                placeholder="例如 1"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">status（可选）</Label>
              <Input
                id="status"
                placeholder="例如 fetched"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
            </div>
          </div>

          <Button disabled={loading || !q.trim()} onClick={() => void runSearch()}>
            {loading ? "搜索中…" : "搜索"}
          </Button>

          {rawError ? (
            <pre className="overflow-x-auto rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap">
              {rawError}
            </pre>
          ) : null}

          {result ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-border/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">实体</CardTitle>
                  <CardDescription className="text-xs">
                    source: {result.entities.source}
                    {result.entities.detail
                      ? ` · ${result.entities.detail}`
                      : ""}
                    {result.entities.error
                      ? ` · ${result.entities.error}`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {result.entities.hits.length === 0 ? (
                    <p className="text-muted-foreground">无命中</p>
                  ) : (
                    <ul className="space-y-2">
                      {result.entities.hits.map((h) => (
                        <li
                          key={h.entityId}
                          className="rounded-md border border-border/60 bg-muted/30 px-3 py-2"
                        >
                          <div className="font-medium">
                            {h.highlights?.canonicalName?.[0] ? (
                              <HighlightedHtml html={h.highlights.canonicalName[0]} />
                            ) : (
                              h.canonicalName
                            )}
                          </div>
                          {h.highlights?.aliases?.[0] ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              别名：<HighlightedHtml html={h.highlights.aliases[0]} />
                            </div>
                          ) : null}
                          <div className="text-xs text-muted-foreground">
                            {h.type} · #{h.entityId} · score {h.score.toFixed(2)}
                            {result.entities.source === "postgresql"
                              ? "（PG 无相关性分数）"
                              : ""}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">爬取 URL</CardTitle>
                  <CardDescription className="text-xs">
                    source: {result.crawledUrls.source}
                    {result.crawledUrls.note
                      ? ` · ${result.crawledUrls.note}`
                      : ""}
                    {result.crawledUrls.detail
                      ? ` · ${result.crawledUrls.detail}`
                      : ""}
                    {result.crawledUrls.error
                      ? ` · ${result.crawledUrls.error}`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {result.crawledUrls.hits.length === 0 ? (
                    <p className="text-muted-foreground">无命中</p>
                  ) : (
                    <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                      {result.crawledUrls.hits.map((row, i) => {
                        if (isEsCrawledHit(row)) {
                          return (
                            <li
                              key={row.crawledUrlId}
                              className="rounded-md border border-border/60 bg-muted/30 px-3 py-2"
                            >
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noreferrer"
                                className="break-all text-sm font-medium text-primary underline-offset-2 hover:underline"
                              >
                                {row.url}
                              </a>
                              <div className="mt-1 text-xs text-muted-foreground">
                                source #{row.sourceId} · {row.status} ·{" "}
                                {row.mimeType ?? "—"} · score{" "}
                                {row.score.toFixed(2)}
                              </div>
                              {row.snippet.includes("<em>") ? (
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                  <HighlightedHtml html={row.snippet} />
                                </p>
                              ) : row.snippet ? (
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                  {row.snippet}
                                </p>
                              ) : null}
                            </li>
                          );
                        }
                        if (isPgCrawledRow(row)) {
                          const id = String(row.id);
                          const preview = row.textPreview?.slice(0, 360);
                          return (
                            <li
                              key={id}
                              className="rounded-md border border-border/60 bg-muted/30 px-3 py-2"
                            >
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noreferrer"
                                className="break-all text-sm font-medium text-primary underline-offset-2 hover:underline"
                              >
                                {row.url}
                              </a>
                              <div className="mt-1 text-xs text-muted-foreground">
                                #{id} · source {String(row.sourceId)} ·{" "}
                                {row.status}
                                {row.source?.name
                                  ? ` · ${row.source.name}`
                                  : ""}
                              </div>
                              {preview ? (
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                  {preview}
                                  {(row.textPreview?.length ?? 0) > 360
                                    ? "…"
                                    : ""}
                                </p>
                              ) : null}
                            </li>
                          );
                        }
                        return (
                          <li
                            key={i}
                            className="rounded-md border border-dashed border-border px-3 py-2 text-xs"
                          >
                            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
                              {JSON.stringify(row, null, 2)}
                            </pre>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
