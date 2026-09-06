"use client";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
import { EntityRankLineChart } from "@/components/entity-rank-line-chart";
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
import { TOPIC_SLUG_MAX_LEN } from "@/lib/admin-input-limits";
import {
  ADMIN_HREF,
  entityRankHistoryAdminPath,
  snapshotDetailAdminPath,
} from "@/lib/admin-web-paths";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import {
  DECIMAL_BIGINT_ID_MAX_DIGITS,
  isDecimalBigIntIdString,
} from "@/lib/decimal-id";
import { NEST_V1_DOC } from "@/lib/nest-api-paths";
import { nestEntityRankHistoryUrl } from "@/lib/nest-api-urls";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

const DEFAULT_TOPIC = "global-female-singers";

type RankHistoryPointRow = {
  asOf: string;
  rank: number;
  snapshotId?: string;
  timeWindow?: string;
};

function RankHistoryPageInner() {
  const { abs } = useAdminAppUrl();
  const router = useRouter();
  const sp = useSearchParams();
  const [entityId, setEntityId] = useState(sp.get("entityId")?.trim() ?? "");
  const [topicSlug, setTopicSlug] = useState(
    sp.get("topicSlug")?.trim() || DEFAULT_TOPIC,
  );
  const [timeWindow, setTimeWindow] = useState(
    sp.get("timeWindow")?.trim() ?? "",
  );
  const [limit, setLimit] = useState(sp.get("limit")?.trim() ?? "80");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [points, setPoints] = useState<RankHistoryPointRow[]>([]);
  const [canonicalName, setCanonicalName] = useState("");

  const apiUrlFromForm = useMemo(() => {
    const id = entityId.trim();
    if (!id || !isDecimalBigIntIdString(id)) return "";
    const q = new URLSearchParams({
      topicSlug: topicSlug.trim() || DEFAULT_TOPIC,
      limit: limit.trim() || "80",
    });
    if (timeWindow.trim()) q.set("timeWindow", timeWindow.trim());
    return nestEntityRankHistoryUrl(id, q);
  }, [entityId, topicSlug, timeWindow, limit]);

  useEffect(() => {
    const id = sp.get("entityId")?.trim() ?? "";
    const t = sp.get("topicSlug")?.trim() || DEFAULT_TOPIC;
    const tw = sp.get("timeWindow")?.trim() ?? "";
    const l = sp.get("limit")?.trim() ?? "80";
    setEntityId(id);
    setTopicSlug(t);
    setTimeWindow(tw);
    setLimit(l);

    if (!id || !isDecimalBigIntIdString(id)) {
      setPoints([]);
      setSummary(null);
      setCanonicalName("");
      setErr("");
      return;
    }

    const q = new URLSearchParams({
      topicSlug: t,
      limit: l || "80",
    });
    if (tw) q.set("timeWindow", tw);
    const url = nestEntityRankHistoryUrl(id, q);

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
          setPoints([]);
          setSummary(null);
          setCanonicalName("");
          return;
        }
        const j = JSON.parse(text) as {
          entity?: { canonicalName?: string };
          summary?: Record<string, unknown>;
          points?: Array<{
            asOf: string;
            rank: number;
            snapshotId?: string;
            timeWindow?: string;
          }>;
        };
        setCanonicalName(j.entity?.canonicalName ?? "");
        setSummary(j.summary ?? null);
        const pts = Array.isArray(j.points) ? j.points : [];
        setPoints(
          pts
            .filter(
              (p) =>
                typeof p.asOf === "string" &&
                typeof p.rank === "number" &&
                Number.isFinite(p.rank),
            )
            .map((p) => ({
              asOf: p.asOf,
              rank: p.rank,
              snapshotId:
                p.snapshotId != null && String(p.snapshotId).trim()
                  ? String(p.snapshotId).trim()
                  : undefined,
              timeWindow:
                p.timeWindow != null ? String(p.timeWindow) : undefined,
            })),
        );
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setPoints([]);
          setSummary(null);
          setCanonicalName("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sp]);

  return (
    <div className="w-full max-w-none space-y-6 p-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">实体名次曲线</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">
            GET {NEST_V1_DOC.entityRankHistory}
          </code>
          {" · "}
          <Link href={ADMIN_HREF.entityTimeline} className="text-primary underline-offset-4 hover:underline">
            多话题时间线
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">参数</CardTitle>
          <CardDescription>
            修改后点「写入地址栏」再拉数（与地址栏 query 一致）。可选{" "}
            <code className="text-xs">timeWindow</code>、
            <code className="text-xs">limit</code>（1–500）。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rh-entity">entityId</Label>
            <Input
              id="rh-entity"
              inputMode="numeric"
              maxLength={DECIMAL_BIGINT_ID_MAX_DIGITS}
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rh-topic">topicSlug</Label>
            <Input
              id="rh-topic"
              maxLength={TOPIC_SLUG_MAX_LEN}
              value={topicSlug}
              onChange={(e) => setTopicSlug(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rh-limit">limit</Label>
            <Input
              id="rh-limit"
              inputMode="numeric"
              maxLength={4}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rh-tw">timeWindow（可选）</Label>
            <Input
              id="rh-tw"
              maxLength={16}
              placeholder="WEEK"
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              type="button"
              disabled={loading}
              onClick={() => {
                router.replace(
                  entityRankHistoryAdminPath(entityId, topicSlug, {
                    timeWindow: timeWindow.trim() || undefined,
                    limit: limit.trim() || undefined,
                  }),
                  { scroll: false },
                );
              }}
            >
              {loading ? "加载中…" : "写入地址栏并加载"}
            </Button>
            {apiUrlFromForm ? (
              <>
                <CopyTextButton
                  text={apiUrlFromForm}
                  idleLabel="复制当前表单 API URL"
                  className="h-9"
                />
                <a
                  href={apiUrlFromForm}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center text-sm text-primary underline-offset-4 hover:underline"
                >
                  新标签 JSON（表单）
                </a>
              </>
            ) : null}
            {entityId.trim() && isDecimalBigIntIdString(entityId.trim()) ? (
              <CopyTextButton
                text={abs(
                  entityRankHistoryAdminPath(entityId, topicSlug, {
                    timeWindow: timeWindow.trim() || undefined,
                    limit: limit.trim() || undefined,
                  }),
                )}
                idleLabel="复制本页路径（表单）"
                className="h-9"
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      {err ? (
        <pre className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap">
          {err}
        </pre>
      ) : null}

      {canonicalName ? (
        <p className="text-sm font-medium">
          {canonicalName}{" "}
          <span className="font-normal text-muted-foreground">
            · entity #{entityId.trim()}
          </span>
        </p>
      ) : null}

      {summary ? (
        <p className="text-xs text-muted-foreground">
          摘要：best {String(summary.bestRank ?? "—")} / worst{" "}
          {String(summary.worstRank ?? "—")}
          {" · "}
          末端连升 {String(summary.endStreakRankImproving ?? "—")} · 连降{" "}
          {String(summary.endStreakRankDeclining ?? "—")}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">名次时间线（ECharts）</CardTitle>
          <CardDescription className="text-xs">
            下方表格含每条历史点对应的 <code className="text-xs">snapshotId</code>（来自{" "}
            <code className="text-xs">RankingItemHistory</code>）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <EntityRankLineChart
            points={points.map((p) => ({ asOf: p.asOf, rank: p.rank }))}
          />
          {points.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      asOf
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      rank
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      window
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      快照
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr
                      key={`${p.asOf}-${p.rank}-${p.snapshotId ?? ""}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <th
                        scope="row"
                        className="whitespace-nowrap px-3 py-2 font-normal text-muted-foreground"
                      >
                        {p.asOf}
                      </th>
                      <td className="px-3 py-2">{p.rank}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.timeWindow ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.snapshotId ? (
                          <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                            <Link
                              href={snapshotDetailAdminPath(p.snapshotId)}
                              className="text-primary underline-offset-2 hover:underline"
                            >
                              #{p.snapshotId}
                            </Link>
                            <CopyTextButton
                              text={abs(snapshotDetailAdminPath(p.snapshotId))}
                              idleLabel="复制快照页"
                              className="h-5 px-2 text-xs"
                            />
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        <Link
          href={ADMIN_HREF.entities}
          className="text-primary underline-offset-2 hover:underline"
        >
          ← 实体列表
        </Link>
      </p>

      <AdminFooterNav />
    </div>
  );
}

export default function EntityRankHistoryPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-none p-6 text-sm text-muted-foreground">
          加载…
        </div>
      }
    >
      <RankHistoryPageInner />
    </Suspense>
  );
}
