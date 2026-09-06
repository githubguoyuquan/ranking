"use client";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
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
import { adminOutboxUrl } from "@/lib/backend-api-urls";
import { BACKEND_ADMIN } from "@/lib/backend-api-paths";
import {
  ENTITY_TYPE_MAX_LEN,
  OUTBOX_LIMIT_INPUT_MAX_LEN,
  OUTBOX_LIST_LIMIT_MAX,
} from "@/lib/admin-input-limits";
import {
  ADMIN_HREF,
  rankingsRunAdminPath,
  snapshotDetailAdminPath,
} from "@/lib/admin-web-paths";
import {
  OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
  parseClickhouseRankingSnapshotOutboxPreview,
  type ClickhouseRankingSnapshotOutboxPreview,
} from "@/lib/outbox-clickhouse-ranking-payload";
import {
  OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC,
  parseElasticCrawledUrlSyncOutboxPreview,
  type ElasticCrawledUrlSyncOutboxPreview,
} from "@/lib/outbox-elastic-crawled-url-payload";
import {
  OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
  parseElasticEntitySyncOutboxPreview,
  type ElasticEntitySyncOutboxPreview,
} from "@/lib/outbox-elastic-entity-payload";
import {
  OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED,
  parseRankingFollowupRequestedOutboxPreview,
  type RankingFollowupRequestedOutboxPreview,
} from "@/lib/outbox-ranking-followup-payload";
import {
  OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
  parseRankingSnapshotCompletedOutboxPreview,
  type RankingSnapshotCompletedOutboxPreview,
} from "@/lib/outbox-ranking-snapshot-payload";
import { unifiedSearchAdminPathFromQuery } from "@/lib/unified-search-admin-path";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";

type OutboxRow = {
  id: string;
  type: string;
  createdAt?: string;
  publishedAt?: string | null;
  leasedUntil?: string | null;
  attempts?: number;
  lastError?: string | null;
  /** `type === ranking.snapshot.completed` 且 `payload` 可解析时 */
  rankingKafkaPreview?: RankingSnapshotCompletedOutboxPreview;
  /** `type === clickhouse.ranking.snapshot.ingest` 且 `payload` 可解析时 */
  clickhouseRankingPreview?: ClickhouseRankingSnapshotOutboxPreview;
  /** `type === elasticsearch.entity.sync` 且 `payload` 可解析时 */
  elasticEntityPreview?: ElasticEntitySyncOutboxPreview;
  /** `type === elasticsearch.crawled_url.sync` 且 `payload` 可解析时 */
  elasticCrawledUrlPreview?: ElasticCrawledUrlSyncOutboxPreview;
  /** `type === ranking.followup.requested` 且 `payload` 可解析时 */
  followupPreview?: RankingFollowupRequestedOutboxPreview;
};

type OutboxTable = {
  count?: number;
  rows: OutboxRow[];
};

function normalizeOutboxRow(r: unknown): OutboxRow | null {
  if (typeof r !== "object" || r === null) return null;
  const o = r as Record<string, unknown>;
  if (o.id == null || o.type == null) return null;
  const type = String(o.type);
  const rankingKafkaPreview = parseRankingSnapshotCompletedOutboxPreview(
    type,
    o.payload,
  );
  const clickhouseRankingPreview =
    parseClickhouseRankingSnapshotOutboxPreview(type, o.payload);
  const elasticEntityPreview = parseElasticEntitySyncOutboxPreview(
    type,
    o.payload,
  );
  const elasticCrawledUrlPreview =
    parseElasticCrawledUrlSyncOutboxPreview(type, o.payload);
  const followupPreview = parseRankingFollowupRequestedOutboxPreview(
    type,
    o.payload,
  );
  return {
    id: String(o.id),
    type,
    createdAt: o.createdAt != null ? String(o.createdAt) : undefined,
    publishedAt:
      o.publishedAt === null
        ? null
        : o.publishedAt != null
          ? String(o.publishedAt)
          : null,
    leasedUntil:
      o.leasedUntil === null
        ? null
        : o.leasedUntil != null
          ? String(o.leasedUntil)
          : null,
    attempts: typeof o.attempts === "number" ? o.attempts : undefined,
    lastError:
      o.lastError === null
        ? null
        : o.lastError != null
          ? String(o.lastError)
          : null,
    ...(rankingKafkaPreview != null ? { rankingKafkaPreview } : {}),
    ...(clickhouseRankingPreview != null
      ? { clickhouseRankingPreview }
      : {}),
    ...(elasticEntityPreview != null ? { elasticEntityPreview } : {}),
    ...(elasticCrawledUrlPreview != null
      ? { elasticCrawledUrlPreview }
      : {}),
    ...(followupPreview != null ? { followupPreview } : {}),
  };
}

function formatTs(iso: string | null | undefined) {
  if (iso == null || iso === "") return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function truncate(s: string | null | undefined, n: number) {
  if (s == null || s === "") return "—";
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

/** pretty-printed JSON：常见 Outbox `payload` 键名（Kafka / CH / ES / followup） */
const OUTBOX_JSON_CONTRACT_KEY_RE =
  /"(?:schemaVersion|action|entityId|crawledUrlId|snapshotId|topicRankingId|topicVersionId|topicId|topicVersionLabel|timeWindow|snapshotTime|snapshotVersion|itemCount|confidenceScore|hasScoreModel|scoreModelId)"/g;

function highlightOutboxJsonContractKeys(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(OUTBOX_JSON_CONTRACT_KEY_RE.source, "g");
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(text.slice(last, m.index));
    }
    parts.push(
      <mark
        key={`outbox-json-hl-${k++}`}
        className="rounded bg-amber-200/55 px-px text-inherit dark:bg-amber-900/45"
      >
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts.length > 0 ? parts : text;
}

/** 列表 JSON 中是否出现排行快照完成 Outbox 行（用于说明文案） */
function outLooksLikeRankingSnapshotOutboxJson(text: string): boolean {
  return (
    text.includes(OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED) &&
    (text.includes('"topicRankingId"') || text.includes('"snapshotTime"'))
  );
}

function outLooksLikeClickhouseRankingOutboxJson(text: string): boolean {
  return text.includes(OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT);
}

function outLooksLikeElasticEntityOutboxJson(text: string): boolean {
  return text.includes(OUTBOX_TYPE_ELASTIC_ENTITY_SYNC);
}

function outLooksLikeElasticCrawledUrlOutboxJson(text: string): boolean {
  return text.includes(OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC);
}

function outLooksLikeRankingFollowupOutboxJson(text: string): boolean {
  return text.includes(OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED);
}

/** 与后端 outbox 列表 API（`BACKEND_ADMIN.outbox`）的 limit 钳制一致（上限 `OUTBOX_LIST_LIMIT_MAX`） */
function normalizeOutboxLimit(raw: string): string {
  const t = raw.trim();
  if (t === "") return "40";
  const n = Math.trunc(Number(t));
  if (!Number.isFinite(n) || n < 1) return "40";
  return String(Math.min(n, OUTBOX_LIST_LIMIT_MAX));
}

export default function OutboxPage() {
  const { abs } = useAdminAppUrl();
  const [limit, setLimit] = useState("40");
  const [typeFilter, setTypeFilter] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState(false);
  const [table, setTable] = useState<OutboxTable | null>(null);

  const showRankingKafkaCols =
    table != null &&
    table.rows.some((r) => r.rankingKafkaPreview != null);

  const showClickhouseRankingCols =
    table != null &&
    table.rows.some((r) => r.clickhouseRankingPreview != null);

  const showElasticEntityCols =
    table != null &&
    table.rows.some((r) => r.elasticEntityPreview != null);

  const showElasticCrawledUrlCols =
    table != null &&
    table.rows.some((r) => r.elasticCrawledUrlPreview != null);

  const showFollowupCols =
    table != null && table.rows.some((r) => r.followupPreview != null);

  const currentApiUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: normalizeOutboxLimit(limit) });
    if (typeFilter.trim()) params.set("type", typeFilter.trim());
    if (pendingOnly) params.set("pendingOnly", "true");
    return adminOutboxUrl(params);
  }, [limit, typeFilter, pendingOnly]);

  async function load(opts?: { type?: string }) {
    const effectiveType =
      opts?.type !== undefined ? opts.type : typeFilter;
    if (opts?.type !== undefined) {
      setTypeFilter(opts.type);
    }

    setLoading(true);
    setOut("");
    setTable(null);
    try {
      const params = new URLSearchParams({ limit: normalizeOutboxLimit(limit) });
      if (effectiveType.trim()) params.set("type", effectiveType.trim());
      if (pendingOnly) params.set("pendingOnly", "true");
      const res = await fetch(adminOutboxUrl(params), {
        cache: "no-store",
      });
      const text = await res.text();
      if (res.ok) {
        try {
          const j = JSON.parse(text) as { count?: number; rows?: unknown[] };
          if (Array.isArray(j.rows)) {
            const rows = j.rows
              .map(normalizeOutboxRow)
              .filter((x): x is OutboxRow => x != null);
            setTable({ count: j.count, rows });
          }
        } catch {
          /* 仅展示 JSON */
        }
      }
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        formatted = text;
      }
      setOut(`${res.ok ? "" : `HTTP ${res.status}\n`}${formatted}`);
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Outbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          GET {BACKEND_ADMIN.outbox} — 只读排查（
          <code className="rounded bg-muted px-1 text-xs">pendingOnly</code> 仅未发布）。生产请不要再暴露公网。ES
          相关积压可配合{" "}
          <span className="inline-flex flex-wrap items-center gap-x-1 align-baseline">
            <Link
              href={ADMIN_HREF.reindex}
              className="text-primary underline-offset-4 hover:underline"
            >
              索引维护
            </Link>
            <CopyAdminPageUrlButton
              path={ADMIN_HREF.reindex}
              idleLabel="复制"
              className="h-5 px-2 text-xs"
            />
          </span>
          。
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyTextButton
            text={abs(ADMIN_HREF.outbox)}
            idleLabel="复制本页链接"
            className="h-6"
          />
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">查询</CardTitle>
          <CardDescription>
            可选 <code className="text-xs">type</code>（≤{" "}
            <code className="text-xs">{ENTITY_TYPE_MAX_LEN}</code> 字符，与 DTO <code className="text-xs">@MaxLength</code>{" "}
            一致）：如{" "}
            <code className="text-xs">elasticsearch.entity.sync</code>、
            <code className="text-xs">elasticsearch.crawled_url.sync</code>、
            <code className="text-xs">
              {OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED}
            </code>
            （Kafka 排行快照完成事件）。后者{" "}
            <code className="text-xs">payload</code> 含{" "}
            <code className="text-xs">schemaVersion</code>、字符串化 id、
            <code className="text-xs">hasScoreModel</code>、
            <code className="text-xs">scoreModelId</code>
            （无模型时为 <code className="text-xs">null</code>）等。另有{" "}
            <code className="text-xs">{OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT}</code>
            （ClickHouse 排行快照入库，进程内 Flusher；{" "}
            <code className="text-xs">payload</code> 为{" "}
            <code className="text-xs">schemaVersion</code> + 字符串化{" "}
            <code className="text-xs">snapshotId</code>）。
            <code className="text-xs">elasticsearch.entity.sync</code> /{" "}
            <code className="text-xs">elasticsearch.crawled_url.sync</code>{" "}
            的 <code className="text-xs">payload</code> 见{" "}
            <code className="text-xs">buildElastic*OutboxPayload</code>（
            <code className="text-xs">src/search/elastic-*-sync-outbox-payload.ts</code>
            ）。
            <code className="text-xs">{OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED}</code>（需{" "}
            <code className="text-xs">RANKING_FOLLOWUP_OUTBOX=true</code>）见{" "}
            <code className="text-xs">buildRankingFollowupRequestedOutboxPayload</code>。
            {" "}
            <code className="text-xs">limit</code> 需为正整数：非法或空视为{" "}
            <code className="text-xs">40</code>，超过 <code className="text-xs">{OUTBOX_LIST_LIMIT_MAX}</code>{" "}
            时按 {OUTBOX_LIST_LIMIT_MAX} 请求（与 DTO 上限一致）。在 limit / type 输入框按{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-xs">Enter</kbd>{" "}
            同「加载」。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="limit">limit</Label>
              <Input
                id="limit"
                inputMode="numeric"
                maxLength={OUTBOX_LIMIT_INPUT_MAX_LEN}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || loading) return;
                  void load();
                }}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="type">type（可选）</Label>
              <Input
                id="type"
                placeholder="elasticsearch.entity.sync"
                maxLength={ENTITY_TYPE_MAX_LEN}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || loading) return;
                  void load();
                }}
              />
            </div>
          </div>
          <label
            htmlFor="outbox-pending-only"
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              id="outbox-pending-only"
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => setPendingOnly(e.target.checked)}
              className="h-4 w-4 rounded border border-input"
            />
            仅未发布（publishedAt 为空）
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">快捷 type：</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={loading}
              onClick={() =>
                void load({ type: "elasticsearch.entity.sync" })
              }
            >
              elasticsearch.entity.sync
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={loading}
              onClick={() =>
                void load({ type: "elasticsearch.crawled_url.sync" })
              }
            >
              elasticsearch.crawled_url.sync
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={loading}
              onClick={() =>
                void load({ type: OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED })
              }
            >
              {OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 max-w-[100%] truncate px-2 text-xs sm:max-w-none"
              title={OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT}
              disabled={loading}
              onClick={() =>
                void load({ type: OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT })
              }
            >
              {OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 max-w-[100%] truncate px-2 text-xs sm:max-w-none"
              title={OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED}
              disabled={loading}
              onClick={() =>
                void load({ type: OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED })
              }
            >
              {OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              disabled={loading}
              onClick={() => void load({ type: "" })}
            >
              清空 type
            </Button>
          </div>
          <Button type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "加载中…" : "加载"}
          </Button>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <a
              href={currentApiUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              新标签打开当前筛选（GET {BACKEND_ADMIN.outbox}）
            </a>
            <CopyTextButton
              text={currentApiUrl}
              idleLabel="复制 API URL"
              className="h-6"
            />
          </p>

          {table && table.rows.length > 0 ? (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                共 {table.count ?? table.rows.length} 条（表格最多展示本页 limit）
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[120rem] text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">id</th>
                      <th scope="col" className="px-3 py-2 font-medium">type</th>
                      {showRankingKafkaCols ? (
                        <>
                          <th scope="col" className="px-3 py-2 font-medium">
                            snapshotId
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            hasScoreModel
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            scoreModelId
                          </th>
                        </>
                      ) : null}
                      {showClickhouseRankingCols ? (
                        <th scope="col" className="px-3 py-2 font-medium">
                          CH snapshotId
                        </th>
                      ) : null}
                      {showElasticEntityCols ? (
                        <>
                          <th scope="col" className="px-3 py-2 font-medium">
                            ES entityId
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            ES action
                          </th>
                        </>
                      ) : null}
                      {showElasticCrawledUrlCols ? (
                        <>
                          <th scope="col" className="px-3 py-2 font-medium">
                            crawlUrlId
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            crawl action
                          </th>
                        </>
                      ) : null}
                      {showFollowupCols ? (
                        <>
                          <th scope="col" className="px-3 py-2 font-medium">
                            followup snapshot
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            topicVer → 跑榜
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            followup window
                          </th>
                        </>
                      ) : null}
                      <th scope="col" className="px-3 py-2 font-medium">attempts</th>
                      <th scope="col" className="px-3 py-2 font-medium">created</th>
                      <th scope="col" className="px-3 py-2 font-medium">published</th>
                      <th scope="col" className="px-3 py-2 font-medium">lease</th>
                      <th scope="col" className="px-3 py-2 font-medium">lastError</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-border/60 last:border-0"
                      >
                      <th
                        scope="row"
                        className="whitespace-nowrap px-3 py-1.5 font-mono text-xs font-normal"
                      >
                        {r.id}
                      </th>
                        <td className="max-w-[14rem] truncate px-3 py-1.5 text-xs">
                          {r.type}
                        </td>
                        {showRankingKafkaCols ? (
                          <>
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                              {r.rankingKafkaPreview ? (
                                <Link
                                  href={snapshotDetailAdminPath(
                                    r.rankingKafkaPreview.snapshotId,
                                  )}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  {r.rankingKafkaPreview.snapshotId}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                              {r.rankingKafkaPreview
                                ? r.rankingKafkaPreview.hasScoreModel
                                  ? "是"
                                  : "否"
                                : "—"}
                            </td>
                            <td className="max-w-[10rem] truncate px-3 py-1.5 font-mono text-xs text-muted-foreground">
                              {r.rankingKafkaPreview?.scoreModelId ?? "—"}
                            </td>
                          </>
                        ) : null}
                        {showClickhouseRankingCols ? (
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                            {r.clickhouseRankingPreview ? (
                              <Link
                                href={snapshotDetailAdminPath(
                                  r.clickhouseRankingPreview.snapshotId,
                                )}
                                className="text-primary underline-offset-4 hover:underline"
                              >
                                {r.clickhouseRankingPreview.snapshotId}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        ) : null}
                        {showElasticEntityCols ? (
                          <>
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                              {r.elasticEntityPreview ? (
                                <Link
                                  href={unifiedSearchAdminPathFromQuery(
                                    r.elasticEntityPreview.entityId,
                                  )}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  {r.elasticEntityPreview.entityId}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                              {r.elasticEntityPreview?.action ?? "—"}
                            </td>
                          </>
                        ) : null}
                        {showElasticCrawledUrlCols ? (
                          <>
                            <td className="max-w-[8rem] truncate px-3 py-1.5 font-mono text-xs">
                              {r.elasticCrawledUrlPreview ? (
                                <Link
                                  href={ADMIN_HREF.crawl}
                                  className="text-primary underline-offset-4 hover:underline"
                                  title={r.elasticCrawledUrlPreview.crawledUrlId}
                                >
                                  {r.elasticCrawledUrlPreview.crawledUrlId}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                              {r.elasticCrawledUrlPreview?.action ?? "—"}
                            </td>
                          </>
                        ) : null}
                        {showFollowupCols ? (
                          <>
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                              {r.followupPreview ? (
                                <Link
                                  href={snapshotDetailAdminPath(
                                    r.followupPreview.snapshotId,
                                  )}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  {r.followupPreview.snapshotId}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                              {r.followupPreview ? (
                                <Link
                                  href={rankingsRunAdminPath(
                                    r.followupPreview.topicVersionId,
                                  )}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  {r.followupPreview.topicVersionId}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                              {r.followupPreview?.timeWindow ?? "—"}
                            </td>
                          </>
                        ) : null}
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                          {r.attempts ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                          {formatTs(r.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                          {r.publishedAt ? formatTs(r.publishedAt) : "待发布"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                          {formatTs(r.leasedUntil ?? undefined)}
                        </td>
                        <td
                          className="max-w-xs px-3 py-1.5 text-xs text-destructive/90"
                          title={r.lastError ?? undefined}
                        >
                          {truncate(r.lastError, 96)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {out ? (
            <div className="space-y-2">
              {outLooksLikeRankingSnapshotOutboxJson(out) ? (
                <p className="text-xs text-muted-foreground">
                  检测到{" "}
                  <code className="rounded bg-muted px-1">
                    {OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED}
                  </code>
                  ：其 <code className="rounded bg-muted px-1">payload</code>{" "}
                  内各契约键名（含{" "}
                  <code className="rounded bg-muted px-1">topicRankingId</code>、
                  <code className="rounded bg-muted px-1">snapshotTime</code>、
                  <code className="rounded bg-muted px-1">itemCount</code>、
                  <code className="rounded bg-muted px-1">hasScoreModel</code>{" "}
                  等）已在下方 JSON 中浅色标记。
                </p>
              ) : null}
              {outLooksLikeClickhouseRankingOutboxJson(out) ? (
                <p className="text-xs text-muted-foreground">
                  检测到{" "}
                  <code className="rounded bg-muted px-1">
                    {OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT}
                  </code>
                  ：其 <code className="rounded bg-muted px-1">payload</code>{" "}
                  内{" "}
                  <code className="rounded bg-muted px-1">schemaVersion</code>、
                  <code className="rounded bg-muted px-1">snapshotId</code>{" "}
                  键名已参与下方高亮（与 Kafka 排行行共用键名样式）。
                </p>
              ) : null}
              {outLooksLikeElasticEntityOutboxJson(out) ? (
                <p className="text-xs text-muted-foreground">
                  检测到{" "}
                  <code className="rounded bg-muted px-1">
                    {OUTBOX_TYPE_ELASTIC_ENTITY_SYNC}
                  </code>
                  ：<code className="rounded bg-muted px-1">entityId</code>、
                  <code className="rounded bg-muted px-1">action</code>{" "}
                  等键名已参与下方高亮。
                </p>
              ) : null}
              {outLooksLikeElasticCrawledUrlOutboxJson(out) ? (
                <p className="text-xs text-muted-foreground">
                  检测到{" "}
                  <code className="rounded bg-muted px-1">
                    {OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC}
                  </code>
                  ：<code className="rounded bg-muted px-1">crawledUrlId</code>
                  、<code className="rounded bg-muted px-1">action</code>{" "}
                  已高亮。
                </p>
              ) : null}
              {outLooksLikeRankingFollowupOutboxJson(out) ? (
                <p className="text-xs text-muted-foreground">
                  检测到{" "}
                  <code className="rounded bg-muted px-1">
                    {OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED}
                  </code>
                  ：与 Kafka 排行行共享字段键名（如{" "}
                  <code className="rounded bg-muted px-1">snapshotId</code>、
                  <code className="rounded bg-muted px-1">topicRankingId</code>
                  ）已高亮。
                </p>
              ) : null}
              <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                {highlightOutboxJsonContractKeys(out)}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AdminFooterNav className="text-muted-foreground" />
    </div>
  );
}
