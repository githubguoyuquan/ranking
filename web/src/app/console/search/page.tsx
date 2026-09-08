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
  SEARCH_CRAWL_STATUS_MAX_LEN,
  SEARCH_SOURCE_ID_QUERY_MAX_LEN,
  UNIFIED_SEARCH_LIMIT_INPUT_MAX_LEN,
  UNIFIED_SEARCH_LIMIT_MAX,
  UNIFIED_SEARCH_Q_MAX_LEN,
} from "@/lib/admin-input-limits";
import {
  DECIMAL_BIGINT_ID_MAX_DIGITS,
  isDecimalBigIntIdString,
} from "@/lib/decimal-id";
import {
  entitiesAdminPrefillPath,
} from "@/lib/entities-admin-path";
import { NEST_V1 } from "@/lib/nest-api-paths";
import {
  nestSearchCrawledUrlsEsUrl,
  nestSearchCrawledUrlsUrl,
  nestSearchEntitiesUrl,
  nestSearchHealthUrl,
  nestSearchUrl,
} from "@/lib/nest-api-urls";
import {
  buildUnifiedSearchWebPath,
  unifiedSearchAdminPathFromQuery,
} from "@/lib/unified-search-admin-path";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

type SearchEsHealth = {
  ok: boolean;
  clusterName?: string;
  detail?: string;
};

type UnifiedSearchResponse = {
  query: string;
  dsl?: {
    text: string;
    filters?: Record<string, string>;
  };
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
  pageTitle?: string | null;
  snippet: string;
  highlights?: Record<string, string[]>;
};

type PgCrawledRow = {
  id: string | number | bigint;
  sourceId: string | number | bigint;
  url: string;
  mimeType: string | null;
  textPreview: string | null;
  pageTitle?: string | null;
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

function parseIndexModeFromQuery(
  v: string | null,
): "auto" | "es" | "pg" | null {
  if (v === "auto" || v === "es" || v === "pg") return v;
  return null;
}

/** 与 `NEST_V1.search`（聚合搜索 API）的 `limit` 校验一致（上限见 `UNIFIED_SEARCH_LIMIT_MAX`） */
function clampUnifiedSearchLimit(raw: string): string {
  const t = raw.trim();
  if (t === "") return "12";
  const n = Math.trunc(Number(t));
  if (!Number.isFinite(n) || n < 1) return "12";
  return String(Math.min(n, UNIFIED_SEARCH_LIMIT_MAX));
}

function crawlRefineSearchHref(args: {
  q: string;
  limit: string;
  crawlIndex: "auto" | "es" | "pg";
  entityIndex: "auto" | "es" | "pg";
  status: string;
  hitSourceId: string;
}) {
  const params = new URLSearchParams({
    q: args.q.trim(),
    limit: clampUnifiedSearchLimit(args.limit),
    crawlIndex: args.crawlIndex,
    entityIndex: args.entityIndex,
  });
  params.set("sourceId", args.hitSourceId);
  const st = args.status.trim();
  if (st) params.set("status", st);
  return buildUnifiedSearchWebPath(params);
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base leading-6 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { abs } = useAdminAppUrl();
  const [q, setQ] = useState("Swift");
  const [limit, setLimit] = useState("12");
  const [crawlIndex, setCrawlIndex] = useState<"auto" | "es" | "pg">("auto");
  const [entityIndex, setEntityIndex] = useState<"auto" | "es" | "pg">("auto");
  const [sourceId, setSourceId] = useState("");
  const [status, setStatus] = useState("");
  const [hybrid, setHybrid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UnifiedSearchResponse | null>(null);
  const [rawError, setRawError] = useState<string>("");
  const [esHealth, setEsHealth] = useState<SearchEsHealth | null>(null);
  const [esHealthErr, setEsHealthErr] = useState<string>("");

  useEffect(() => {
    const qp = searchParams.get("q");
    if (qp !== null) {
      setQ(
        qp.length <= UNIFIED_SEARCH_Q_MAX_LEN
          ? qp
          : qp.slice(0, UNIFIED_SEARCH_Q_MAX_LEN),
      );
    }

    const lp = searchParams.get("limit");
    if (lp != null && lp.trim() !== "") {
      setLimit(clampUnifiedSearchLimit(lp));
    }

    const ei = parseIndexModeFromQuery(searchParams.get("entityIndex"));
    if (ei) setEntityIndex(ei);

    const ci = parseIndexModeFromQuery(searchParams.get("crawlIndex"));
    if (ci) setCrawlIndex(ci);

    const sid = searchParams.get("sourceId");
    if (sid !== null) {
      setSourceId(
        sid.length <= SEARCH_SOURCE_ID_QUERY_MAX_LEN
          ? sid
          : sid.slice(0, SEARCH_SOURCE_ID_QUERY_MAX_LEN),
      );
    }

    const st = searchParams.get("status");
    if (st !== null) {
      setStatus(
        st.length <= SEARCH_CRAWL_STATUS_MAX_LEN
          ? st
          : st.slice(0, SEARCH_CRAWL_STATUS_MAX_LEN),
      );
    }

    setHybrid(searchParams.get("hybrid") === "1" || searchParams.get("hybrid") === "true");
  }, [searchParams]);

  const unifiedSearchParams = useMemo(() => {
    const params = new URLSearchParams({
      q: q.trim(),
      limit: clampUnifiedSearchLimit(limit),
      crawlIndex,
      entityIndex,
    });
    const sid = sourceId.trim();
    const st = status.trim();
    if (sid) params.set("sourceId", sid);
    if (st) params.set("status", st);
    if (hybrid) params.set("hybrid", "1");
    return params;
  }, [q, limit, crawlIndex, entityIndex, sourceId, status, hybrid]);

  const searchApiUrl = useMemo(
    () => nestSearchUrl(unifiedSearchParams),
    [unifiedSearchParams],
  );

  const searchAdminPath = useMemo(
    () => buildUnifiedSearchWebPath(unifiedSearchParams),
    [unifiedSearchParams],
  );

  const searchEntitiesSubUrl = useMemo(() => {
    const qt = q.trim();
    if (!qt) return "";
    const params = new URLSearchParams({
      q: qt,
      limit: clampUnifiedSearchLimit(limit),
      engine: entityIndex,
    });
    return nestSearchEntitiesUrl(params);
  }, [q, limit, entityIndex]);

  const crawledSubSearchParams = useMemo(() => {
    const qt = q.trim();
    if (qt.length < 2) return null;
    const params = new URLSearchParams({
      q: qt,
      limit: clampUnifiedSearchLimit(limit),
    });
    const sid = sourceId.trim();
    const st = status.trim();
    if (sid) params.set("sourceId", sid);
    if (st) params.set("status", st);
    return params;
  }, [q, limit, sourceId, status]);

  const searchCrawledUrlsSubUrl = useMemo(
    () =>
      crawledSubSearchParams
        ? nestSearchCrawledUrlsUrl(crawledSubSearchParams)
        : "",
    [crawledSubSearchParams],
  );

  const searchCrawledUrlsEsSubUrl = useMemo(
    () =>
      crawledSubSearchParams
        ? nestSearchCrawledUrlsEsUrl(crawledSubSearchParams)
        : "",
    [crawledSubSearchParams],
  );

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(nestSearchHealthUrl(), {
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

  const searchRequest = useRef<AbortController | null>(null);
  useEffect(() => () => searchRequest.current?.abort(), []);

  async function runSearch() {
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setLoading(true);
    setResult(null);
    setRawError("");
    try {
      const sid = sourceId.trim();
      if (sid && !isDecimalBigIntIdString(sid)) {
        setRawError(
          `sourceId 若填写须为十进制 Crawl Source 主键（至多 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位数字），与后端 BigInt 解析一致。`,
        );
        return;
      }

      router.replace(buildUnifiedSearchWebPath(unifiedSearchParams), {
        scroll: false,
      });

      const res = await fetch(nestSearchUrl(unifiedSearchParams), { cache: "no-store", signal: controller.signal });
      const text = await res.text();
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setRawError(`HTTP ${res.status}\n${text}`);
        return;
      }
      setResult(JSON.parse(text) as UnifiedSearchResponse);
    } catch (e) {
      if (controller.signal.aborted) return;
      setRawError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">搜索</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">GET {NEST_V1.search}</code>
          ：实体（
          <code className="rounded bg-muted px-1">entityIndex</code>）与爬取（
          <code className="rounded bg-muted px-1">crawlIndex</code>）。内联 DSL 如{" "}
          <code className="text-xs">type:PERSON since:7d</code>；<code className="text-xs">hybrid=1</code>{" "}
          启用全文+向量 RRF（需 OPENAI + qdrant/es）。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Elasticsearch{" "}
          <code className="rounded bg-muted px-1">GET {NEST_V1.searchHealth}</code>
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
          {" · "}
          <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
            <a
              href={nestSearchHealthUrl()}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              新标签打开 JSON
            </a>
            <CopyTextButton
              text={nestSearchHealthUrl()}
              idleLabel="复制 ES health URL"
              className="h-6"
            />
          </span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">查询</CardTitle>
          <CardDescription>
            实体默认 auto：有 <code className="text-xs">ELASTICSEARCH_NODE</code>{" "}
            用 ES，否则用 PG；也可用 entityIndex 强制。<code className="text-xs">q</code> 最长{" "}
            <code className="text-xs">{UNIFIED_SEARCH_Q_MAX_LEN}</code> 字符。<code className="text-xs">limit</code> 与{" "}
            <code className="text-xs">GET {NEST_V1.search}</code> 一致为 1–
            <code className="text-xs">{UNIFIED_SEARCH_LIMIT_MAX}</code>（非法或过大时前端会钳制）。<code className="text-xs">sourceId</code>{" "}
            若填写须为十进制（至多 {DECIMAL_BIGINT_ID_MAX_DIGITS} 位，与 <code className="text-xs">BigInt</code>
            一致），字符串最长 <code className="text-xs">{SEARCH_SOURCE_ID_QUERY_MAX_LEN}</code>；<code className="text-xs">status</code>{" "}
            最长 <code className="text-xs">{SEARCH_CRAWL_STATUS_MAX_LEN}</code> 字符。在有 <code className="text-xs">q</code>{" "}
            的前提下，limit / sourceId / status 框内也可按{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-xs">Enter</kbd>{" "}
            搜索。表单下方可新标签打开与当前参数一致的{" "}
            <code className="text-xs">{NEST_V1.searchEntities}</code>、
            <code className="text-xs">{NEST_V1.searchCrawledUrls}</code> /{" "}
            <code className="text-xs">{NEST_V1.searchCrawledUrlsEs}</code>（爬取分项须 q≥2 字符）。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="q">q</Label>
              <Input
                id="q"
                maxLength={UNIFIED_SEARCH_Q_MAX_LEN}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || loading || !q.trim()) return;
                  void runSearch();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit">limit</Label>
              <Input
                id="limit"
                inputMode="numeric"
                maxLength={UNIFIED_SEARCH_LIMIT_INPUT_MAX_LEN}
                placeholder={`1–${UNIFIED_SEARCH_LIMIT_MAX}`}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || loading || !q.trim()) return;
                  void runSearch();
                }}
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
            <div className="flex items-end gap-2 pb-2">
              <input
                id="hybrid"
                type="checkbox"
                checked={hybrid}
                onChange={(e) => setHybrid(e.target.checked)}
                className="size-4 rounded border border-input"
              />
              <Label htmlFor="hybrid" className="cursor-pointer">
                hybrid（RRF 全文+向量）
              </Label>
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
                inputMode="numeric"
                maxLength={SEARCH_SOURCE_ID_QUERY_MAX_LEN}
                placeholder="例如 1"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || loading || !q.trim()) return;
                  void runSearch();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">status（可选）</Label>
              <Input
                id="status"
                maxLength={SEARCH_CRAWL_STATUS_MAX_LEN}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || loading || !q.trim()) return;
                  void runSearch();
                }}
              />
            </div>
          </div>

          <div className="space-y-2 text-xs text-muted-foreground">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href={searchApiUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                新标签打开当前参数（GET {NEST_V1.search}）
              </a>
              <CopyTextButton
                text={searchApiUrl}
                idleLabel="复制 API URL"
                className="h-6"
              />
              <CopyTextButton
                text={abs(searchAdminPath)}
                idleLabel="复制本页链接"
                className="h-6"
              />
            </p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {searchEntitiesSubUrl ? (
                <>
                  <a
                    href={searchEntitiesSubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    实体子检索（GET {NEST_V1.searchEntities}，q / limit / engine）
                  </a>
                  <CopyTextButton
                    text={searchEntitiesSubUrl}
                    idleLabel="复制实体子检索 URL"
                    className="h-6"
                  />
                </>
              ) : (
                <span className="text-muted-foreground/90">
                  实体子检索需非空 <code className="text-xs">q</code>
                </span>
              )}
            </p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {searchCrawledUrlsSubUrl ? (
                <>
                  <a
                    href={searchCrawledUrlsSubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    爬取 PG（GET {NEST_V1.searchCrawledUrls}）
                  </a>
                  <CopyTextButton
                    text={searchCrawledUrlsSubUrl}
                    idleLabel="复制爬取 PG URL"
                    className="h-6"
                  />
                </>
              ) : null}
              {searchCrawledUrlsEsSubUrl ? (
                <>
                  <a
                    href={searchCrawledUrlsEsSubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    爬取 ES（GET {NEST_V1.searchCrawledUrlsEs}）
                  </a>
                  <CopyTextButton
                    text={searchCrawledUrlsEsSubUrl}
                    idleLabel="复制爬取 ES URL"
                    className="h-6"
                  />
                </>
              ) : null}
              {!searchCrawledUrlsSubUrl && !searchCrawledUrlsEsSubUrl ? (
                <span className="text-muted-foreground/90">
                  爬取分项 API 需 <code className="text-xs">q</code> 至少 2 字符（与后端{" "}
                  <code className="text-xs">MinLength(2)</code> 一致）
                </span>
              ) : null}
            </p>
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
                          <Link
                            href={unifiedSearchAdminPathFromQuery(h.canonicalName)}
                            className="block font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {h.highlights?.canonicalName?.[0] ? (
                              <HighlightedHtml
                                className="[&_em]:rounded-md [&_em]:bg-amber-500/20 [&_em]:px-0.5 [&_em]:not-italic"
                                html={h.highlights.canonicalName[0]}
                              />
                            ) : (
                              h.canonicalName
                            )}
                          </Link>
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
                          <p className="mt-1.5 text-xs">
                            <Link
                              href={entitiesAdminPrefillPath(h.canonicalName)}
                              className="text-primary underline-offset-2 hover:underline"
                            >
                              在实体列表打开
                            </Link>
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
                            <CopyTextButton
                              text={abs(
                                unifiedSearchAdminPathFromQuery(
                                  h.canonicalName,
                                ),
                              )}
                              idleLabel="复制搜索页"
                              className="h-5 px-2 text-xs"
                            />
                            <CopyTextButton
                              text={abs(
                                entitiesAdminPrefillPath(h.canonicalName),
                              )}
                              idleLabel="复制实体页"
                              className="h-5 px-2 text-xs"
                            />
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
                          const refineHref = crawlRefineSearchHref({
                            q: result.query,
                            limit,
                            crawlIndex,
                            entityIndex,
                            status,
                            hitSourceId: String(row.sourceId),
                          });
                          return (
                            <li
                              key={row.crawledUrlId}
                              className="rounded-md border border-border/60 bg-muted/30 px-3 py-2"
                            >
                              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                                <a
                                  href={row.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="min-w-0 flex-1 break-all text-sm font-medium text-primary underline-offset-2 hover:underline"
                                >
                                  {row.url}
                                </a>
                                <CopyTextButton
                                  text={row.url}
                                  idleLabel="复制页面 URL"
                                  className="h-6 shrink-0"
                                />
                              </div>
                              {row.pageTitle ? (
                                <p className="mt-1 text-xs font-medium text-foreground/90">
                                  {row.highlights?.pageTitle?.[0] ? (
                                    <HighlightedHtml
                                      className="[&_em]:rounded-md [&_em]:bg-amber-500/20 [&_em]:px-0.5 [&_em]:not-italic"
                                      html={row.highlights.pageTitle[0]}
                                    />
                                  ) : (
                                    row.pageTitle
                                  )}
                                </p>
                              ) : null}
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  source #{row.sourceId} · {row.status} ·{" "}
                                  {row.mimeType ?? "—"} · score{" "}
                                  {row.score.toFixed(2)}
                                </span>
                                <Link
                                  href={refineHref}
                                  className="shrink-0 text-primary underline-offset-2 hover:underline"
                                >
                                  限定该 source
                                </Link>
                                <CopyTextButton
                                  text={abs(refineHref)}
                                  idleLabel="复制限定搜索"
                                  className="h-5 px-2 text-xs"
                                />
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
                          const refineHref = crawlRefineSearchHref({
                            q: result.query,
                            limit,
                            crawlIndex,
                            entityIndex,
                            status,
                            hitSourceId: String(row.sourceId),
                          });
                          return (
                            <li
                              key={id}
                              className="rounded-md border border-border/60 bg-muted/30 px-3 py-2"
                            >
                              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                                <a
                                  href={row.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="min-w-0 flex-1 break-all text-sm font-medium text-primary underline-offset-2 hover:underline"
                                >
                                  {row.url}
                                </a>
                                <CopyTextButton
                                  text={row.url}
                                  idleLabel="复制页面 URL"
                                  className="h-6 shrink-0"
                                />
                              </div>
                              {row.pageTitle ? (
                                <p className="mt-1 text-xs font-medium text-foreground/90">
                                  {row.pageTitle}
                                </p>
                              ) : null}
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  #{id} · source {String(row.sourceId)} ·{" "}
                                  {row.status}
                                  {row.source?.name
                                    ? ` · ${row.source.name}`
                                    : ""}
                                </span>
                                <Link
                                  href={refineHref}
                                  className="shrink-0 text-primary underline-offset-2 hover:underline"
                                >
                                  限定该 source
                                </Link>
                                <CopyTextButton
                                  text={abs(refineHref)}
                                  idleLabel="复制限定搜索"
                                  className="h-5 px-2 text-xs"
                                />
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
                            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">
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

      <AdminFooterNav />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-none p-6 text-sm text-muted-foreground">
          加载搜索表单…
        </div>
      }
    >
      <SearchPageInner />
    </Suspense>
  );
}
