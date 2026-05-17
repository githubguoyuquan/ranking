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
  ISO_DATETIME_INPUT_MAX_LEN,
  LEADERBOARD_VERSION_QUERY_MAX_LEN,
  TIME_WINDOW_INPUT_MAX_LEN,
  TOPIC_SLUG_MAX_LEN,
} from "@/lib/admin-input-limits";
import {
  ADMIN_HREF,
  rankingsRunAdminPath,
  snapshotDetailAdminPath,
  topicsAdminPath,
} from "@/lib/admin-web-paths";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { entitiesAdminPrefillPath } from "@/lib/entities-admin-path";
import { NEST_V1_DOC } from "@/lib/nest-api-paths";
import {
  nestTopicLeaderboardUrl,
  nestTopicVersionsUrl,
} from "@/lib/nest-api-urls";
import { unifiedSearchAdminPathFromQuery } from "@/lib/unified-search-admin-path";
import { isIsoDateString } from "@/lib/iso-date";
import { TIME_WINDOW_SET } from "@/lib/time-window";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

type TopicVersionRow = {
  id: string;
  version: string;
  effectiveFrom?: string;
};

type LeaderboardPreview = {
  resolved: {
    snapshotId: string;
    topicVersionId: string;
    topicSlug: string;
    topicTitle?: string;
    version?: string;
    timeWindow?: string;
    windowStart?: string;
    windowEnd?: string;
    snapshotTime?: string;
  };
  items: Array<{
    rank: number;
    canonicalName: string;
    popularityScore: number | null;
    previousRank: number | null;
    rankChange: number | null;
  }>;
};

function parseVersionsJson(text: string): TopicVersionRow[] {
  try {
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return [];
    const rows: TopicVersionRow[] = [];
    for (const x of arr) {
      if (typeof x !== "object" || x === null) continue;
      const o = x as Record<string, unknown>;
      if (o.id == null || o.version == null) continue;
      rows.push({
        id: String(o.id),
        version: String(o.version),
        effectiveFrom:
          o.effectiveFrom != null ? String(o.effectiveFrom) : undefined,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function parseLeaderboardPreview(data: unknown): LeaderboardPreview | null {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  const resolved = o.resolved;
  if (typeof resolved !== "object" || resolved === null) return null;
  const r = resolved as Record<string, unknown>;
  const snapshotId = r.snapshotId != null ? String(r.snapshotId) : "";
  const topicVersionId = r.topicVersionId != null ? String(r.topicVersionId) : "";
  const topicSlug = r.topicSlug != null ? String(r.topicSlug) : "";
  if (!snapshotId || !topicVersionId) return null;

  const snap = o.snapshot;
  if (typeof snap !== "object" || snap === null) return null;
  const itemsRaw = (snap as Record<string, unknown>).items;
  if (!Array.isArray(itemsRaw)) return null;

  const items: LeaderboardPreview["items"] = [];
  for (const x of itemsRaw) {
    if (typeof x !== "object" || x === null) continue;
    const it = x as Record<string, unknown>;
    const rank =
      typeof it.rank === "number"
        ? it.rank
        : Number(it.rank);
    if (!Number.isFinite(rank)) continue;
    let canonicalName = "—";
    const entity = it.entity;
    if (typeof entity === "object" && entity !== null) {
      const e = entity as Record<string, unknown>;
      if (e.canonicalName != null) canonicalName = String(e.canonicalName);
    }
    const popularityScore =
      typeof it.popularityScore === "number" &&
      Number.isFinite(it.popularityScore)
        ? it.popularityScore
        : null;
    const previousRank =
      typeof it.previousRank === "number" && Number.isFinite(it.previousRank)
        ? it.previousRank
        : it.previousRank == null
          ? null
          : Number(it.previousRank);
    const rankChange =
      typeof it.rankChange === "number" && Number.isFinite(it.rankChange)
        ? it.rankChange
        : it.rankChange == null
          ? null
          : Number(it.rankChange);

    items.push({
      rank,
      canonicalName,
      popularityScore,
      previousRank:
        previousRank != null && Number.isFinite(previousRank)
          ? previousRank
          : null,
      rankChange:
        rankChange != null && Number.isFinite(rankChange) ? rankChange : null,
    });
  }

  items.sort((a, b) => a.rank - b.rank);

  return {
    resolved: {
      snapshotId,
      topicVersionId,
      topicSlug,
      topicTitle:
        r.topicTitle != null ? String(r.topicTitle) : undefined,
      version: r.version != null ? String(r.version) : undefined,
      timeWindow:
        r.timeWindow != null ? String(r.timeWindow) : undefined,
      windowStart:
        r.windowStart != null ? String(r.windowStart) : undefined,
      windowEnd:
        r.windowEnd != null ? String(r.windowEnd) : undefined,
      snapshotTime:
        r.snapshotTime != null ? String(r.snapshotTime) : undefined,
    },
    items,
  };
}

function clampQueryParam(raw: string, maxLen: number): string {
  const t = raw.trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

function TopicsPageInner() {
  const { abs } = useAdminAppUrl();
  const searchParams = useSearchParams();
  const [slug, setSlug] = useState("global-female-singers");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [versionRows, setVersionRows] = useState<TopicVersionRow[]>([]);

  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardResult, setLeaderboardResult] = useState<string>("");
  const [leaderboardPreview, setLeaderboardPreview] =
    useState<LeaderboardPreview | null>(null);
  const [lbQueryVersion, setLbQueryVersion] = useState("");
  const [lbQueryTimeWindow, setLbQueryTimeWindow] = useState("");
  const [lbQueryWindowStart, setLbQueryWindowStart] = useState("");

  const slugForApi = slug.trim() || "global-female-singers";

  const versionsApiUrl = useMemo(
    () => nestTopicVersionsUrl(slugForApi),
    [slugForApi],
  );

  const leaderboardApiUrl = useMemo(() => {
    const q = new URLSearchParams();
    const ver = lbQueryVersion.trim();
    const tw = lbQueryTimeWindow.trim();
    const ws = lbQueryWindowStart.trim();
    if (ver) q.set("version", ver);
    if (tw) q.set("timeWindow", tw);
    if (ws) q.set("windowStart", ws);
    return nestTopicLeaderboardUrl(slugForApi, q);
  }, [slugForApi, lbQueryVersion, lbQueryTimeWindow, lbQueryWindowStart]);

  useEffect(() => {
    const s = searchParams.get("slug");
    if (s?.trim()) setSlug(clampQueryParam(s, TOPIC_SLUG_MAX_LEN));
    const v = searchParams.get("version");
    if (v?.trim())
      setLbQueryVersion(clampQueryParam(v, LEADERBOARD_VERSION_QUERY_MAX_LEN));
    const tw = searchParams.get("timeWindow");
    if (tw?.trim())
      setLbQueryTimeWindow(clampQueryParam(tw, TIME_WINDOW_INPUT_MAX_LEN));
    const ws = searchParams.get("windowStart");
    if (ws?.trim())
      setLbQueryWindowStart(clampQueryParam(ws, ISO_DATETIME_INPUT_MAX_LEN));
  }, [searchParams]);

  async function loadLeaderboard() {
    setLeaderboardLoading(true);
    setLeaderboardResult("");
    setLeaderboardPreview(null);
    const ws = lbQueryWindowStart.trim();
    const tw = lbQueryTimeWindow.trim();
    if (ws && !tw) {
      setLeaderboardLoading(false);
      setLeaderboardResult(
        "若填写 windowStart，请同时填写 timeWindow（例如 WEEK）。",
      );
      return;
    }
    if (tw && !TIME_WINDOW_SET.has(tw)) {
      setLeaderboardLoading(false);
      setLeaderboardResult(
        `timeWindow 须为 ${[...TIME_WINDOW_SET].join(" / ")} 之一（与话题热榜 API 一致）。`,
      );
      return;
    }
    if (ws && !isIsoDateString(ws)) {
      setLeaderboardLoading(false);
      setLeaderboardResult(
        "windowStart 须为可被解析的 ISO 8601 日期时间（与 LeaderboardQueryDto @IsDateString 一致）。",
      );
      return;
    }
    try {
      const q = new URLSearchParams();
      const ver = lbQueryVersion.trim();
      if (ver) q.set("version", ver);
      if (tw) q.set("timeWindow", tw);
      if (ws) q.set("windowStart", ws);
      const url = nestTopicLeaderboardUrl(slugForApi, q);
      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text();
      if (res.ok) {
        try {
          const j = JSON.parse(text) as unknown;
          const prev = parseLeaderboardPreview(j);
          setLeaderboardPreview(prev);
        } catch {
          setLeaderboardPreview(null);
        }
      }
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        formatted = text;
      }
      setLeaderboardResult(`${res.ok ? "" : `HTTP ${res.status}\n`}${formatted}`);
    } catch (e) {
      setLeaderboardResult(e instanceof Error ? e.message : String(e));
    } finally {
      setLeaderboardLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setResult("");
    setVersionRows([]);
    try {
      const res = await fetch(nestTopicVersionsUrl(slugForApi), {
        cache: "no-store",
      });
      const text = await res.text();
      if (res.ok) {
        setVersionRows(parseVersionsJson(text));
      } else {
        setVersionRows([]);
      }
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        formatted = text;
      }
      setResult(`${res.ok ? "" : `HTTP ${res.status}\n`}${formatted}`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const lb = leaderboardPreview;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">话题版本</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.topicsVersions}</code> ·{" "}
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.topicsLeaderboard}</code>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">查询</CardTitle>
          <CardDescription>
            演示数据默认 slug：global-female-singers（输入框留空时 API 亦用此值）。            slug 最多{" "}
            <code className="text-xs">{TOPIC_SLUG_MAX_LEN}</code> 字符；热榜 version（query）最多{" "}
            <code className="text-xs">{LEADERBOARD_VERSION_QUERY_MAX_LEN}</code>；<code className="text-xs">timeWindow</code>{" "}
            最多 <code className="text-xs">{TIME_WINDOW_INPUT_MAX_LEN}</code>；<code className="text-xs">windowStart</code>{" "}
            最多 <code className="text-xs">{ISO_DATETIME_INPUT_MAX_LEN}</code>。URL 可预填{" "}
            <code className="text-xs">
              ?slug=&amp;version=&amp;timeWindow=&amp;windowStart=
            </code>
            （热榜查询串与 API 一致）。在 slug 或热榜参数框内按{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-[10px]">Enter</kbd>{" "}
            可触发「版本列表」或「热榜」。加载版本成功后可用表格中的「跑榜」跳转到{" "}
            <code className="text-xs">{ADMIN_HREF.rankingsRun}?topicVersionId=…</code>。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="slug">slug</Label>
              <Input
                id="slug"
                maxLength={TOPIC_SLUG_MAX_LEN}
                placeholder="global-female-singers"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || loading) return;
                  void load();
                }}
              />
            </div>
            <Button disabled={loading} onClick={() => void load()}>
              {loading ? "加载中…" : "版本列表"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={leaderboardLoading}
              onClick={() => void loadLeaderboard()}
            >
              {leaderboardLoading ? "加载中…" : "热榜"}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="lb-version">version（热榜，可选）</Label>
              <Input
                id="lb-version"
                maxLength={LEADERBOARD_VERSION_QUERY_MAX_LEN}
                placeholder="2026.05"
                value={lbQueryVersion}
                onChange={(e) => setLbQueryVersion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || leaderboardLoading) return;
                  void loadLeaderboard();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lb-tw">timeWindow（可选）</Label>
              <Input
                id="lb-tw"
                maxLength={TIME_WINDOW_INPUT_MAX_LEN}
                placeholder="WEEK"
                value={lbQueryTimeWindow}
                onChange={(e) => setLbQueryTimeWindow(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || leaderboardLoading) return;
                  void loadLeaderboard();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lb-ws">windowStart ISO（可选）</Label>
              <Input
                id="lb-ws"
                maxLength={ISO_DATETIME_INPUT_MAX_LEN}
                placeholder="2026-05-10T00:00:00.000Z"
                value={lbQueryWindowStart}
                onChange={(e) => setLbQueryWindowStart(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || leaderboardLoading) return;
                  void loadLeaderboard();
                }}
              />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            填写 <code className="rounded bg-muted px-1">windowStart</code> 时必须同时填写{" "}
            <code className="rounded bg-muted px-1">timeWindow</code>
            （REALTIME / DAY / WEEK / MONTH / YEAR / CUSTOM）。
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <CopyTextButton
              text={abs(topicsAdminPath(slugForApi))}
              idleLabel="复制话题页链接"
              className="h-6"
            />
            <a
              href={versionsApiUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              新标签打开当前 slug 的版本列表（JSON）
            </a>
            <CopyTextButton
              text={versionsApiUrl}
              idleLabel="复制版本列表 URL"
              className="h-6"
            />
            <a
              href={leaderboardApiUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              新标签打开当前热榜查询（JSON）
            </a>
            <CopyTextButton
              text={leaderboardApiUrl}
              idleLabel="复制热榜 URL"
              className="h-6"
            />
          </p>

          {lb ? (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <div className="font-medium text-foreground">
                {lb.resolved.topicTitle ?? lb.resolved.topicSlug}{" "}
                <span className="font-normal text-muted-foreground">
                  · {lb.resolved.version ?? "—"} · {lb.resolved.timeWindow ?? "—"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                窗口 {lb.resolved.windowStart ?? "—"} → {lb.resolved.windowEnd ?? "—"}
                {lb.resolved.snapshotTime ? (
                  <> · 快照时间 {lb.resolved.snapshotTime}</>
                ) : null}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <Link
                  href={snapshotDetailAdminPath(lb.resolved.snapshotId)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  打开快照 #{lb.resolved.snapshotId}
                </Link>
                <CopyTextButton
                  text={abs(snapshotDetailAdminPath(lb.resolved.snapshotId))}
                  idleLabel="复制快照页链接"
                  className="h-6"
                />
                <CopyTextButton
                  text={lb.resolved.snapshotId}
                  idleLabel="复制 snapshotId"
                  className="h-6"
                />
                <Link
                  href={rankingsRunAdminPath(lb.resolved.topicVersionId)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  用此 topicVersionId 跑榜
                </Link>
                <CopyTextButton
                  text={abs(rankingsRunAdminPath(lb.resolved.topicVersionId))}
                  idleLabel="复制跑榜页链接"
                  className="h-6"
                />
                <CopyTextButton
                  text={lb.resolved.topicVersionId}
                  idleLabel="复制 topicVersionId"
                  className="h-6"
                />
              </p>
              <div className="mt-3 overflow-x-auto rounded-md border border-border bg-card">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">#</th>
                      <th scope="col" className="px-3 py-2 font-medium">实体</th>
                      <th scope="col" className="px-3 py-2 font-medium">分</th>
                      <th scope="col" className="px-3 py-2 font-medium">上次</th>
                      <th scope="col" className="px-3 py-2 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lb.items.map((row) => (
                      <tr
                        key={`${row.rank}-${row.canonicalName}`}
                        className="border-b border-border/60 last:border-0"
                      >
                        <th scope="row" className="px-3 py-1.5 font-normal">
                          {row.rank}
                        </th>
                        <td className="px-3 py-1.5">
                          {row.canonicalName !== "—" ? (
                            <>
                              <Link
                                href={unifiedSearchAdminPathFromQuery(row.canonicalName)}
                                className="text-primary underline-offset-2 hover:underline"
                              >
                                {row.canonicalName}
                              </Link>
                              <div className="mt-0.5 text-[11px]">
                                <Link
                                  href={entitiesAdminPrefillPath(row.canonicalName)}
                                  className="text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                                >
                                  实体列表
                                </Link>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <CopyTextButton
                                  text={abs(
                                    unifiedSearchAdminPathFromQuery(
                                      row.canonicalName,
                                    ),
                                  )}
                                  idleLabel="复制搜索页"
                                  className="h-5 px-2 text-[10px]"
                                />
                                <CopyTextButton
                                  text={abs(
                                    entitiesAdminPrefillPath(row.canonicalName),
                                  )}
                                  idleLabel="复制实体页"
                                  className="h-5 px-2 text-[10px]"
                                />
                              </div>
                            </>
                          ) : (
                            row.canonicalName
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {row.popularityScore != null
                            ? row.popularityScore.toFixed(3)
                            : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {row.previousRank ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {row.rankChange ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {leaderboardResult ? (
            <pre className="max-h-[280px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              {leaderboardResult}
            </pre>
          ) : null}

          {versionRows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">version</th>
                    <th scope="col" className="px-3 py-2 font-medium">topicVersionId</th>
                    <th scope="col" className="px-3 py-2 font-medium">effectiveFrom</th>
                    <th scope="col" className="px-3 py-2 font-medium"> </th>
                  </tr>
                </thead>
                <tbody>
                  {versionRows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <th scope="row" className="px-3 py-2 font-normal">
                        {r.version}
                      </th>
                      <td className="px-3 py-2">
                        <code className="rounded bg-muted px-1 text-xs">{r.id}</code>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.effectiveFrom ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                          <Link
                            href={rankingsRunAdminPath(r.id)}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            跑榜
                          </Link>
                          <CopyTextButton
                            text={abs(rankingsRunAdminPath(r.id))}
                            idleLabel="复制跑榜页"
                            className="h-6 px-2 text-xs"
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {result ? (
            <pre className="max-h-[480px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              {result}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <AdminFooterNav />
    </div>
  );
}

export default function TopicsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
          加载…
        </div>
      }
    >
      <TopicsPageInner />
    </Suspense>
  );
}
