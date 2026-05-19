"use client";

import { useAdminChrome } from "@/components/admin-chrome-context";
import { Button } from "@/components/ui/button";
import { adminBiOverviewUrl } from "@/lib/backend-api-urls";
import type { BiOverview } from "@/lib/bi-types";
import { ADMIN_HREF, snapshotDetailAdminPath } from "@/lib/admin-web-paths";
import { cn } from "@/lib/utils";
import * as echarts from "echarts";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_MS = 30_000;

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}
const CHART_TEXT = "#94a3b8";
const CHART_GRID = "rgba(148,163,184,0.08)";

function formatClock(d: Date): string {
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function KpiCard({
  label,
  value,
  sub,
  accent = "violet",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "violet" | "cyan" | "amber" | "emerald" | "rose";
}) {
  const ring: Record<string, string> = {
    violet: "border-violet-500/40 shadow-[0_0_24px_oklch(0.55_0.2_300_/_0.2)]",
    cyan: "border-cyan-500/40 shadow-[0_0_24px_oklch(0.65_0.15_195_/_0.2)]",
    amber: "border-amber-500/40 shadow-[0_0_24px_oklch(0.75_0.15_75_/_0.15)]",
    emerald: "border-emerald-500/40 shadow-[0_0_24px_oklch(0.65_0.15_155_/_0.15)]",
    rose: "border-rose-500/40 shadow-[0_0_24px_oklch(0.6_0.2_15_/_0.15)]",
  };
  return (
    <div
      className={cn(
        "rounded-xl border bg-black/40 px-4 py-3 backdrop-blur-md",
        ring[accent],
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] text-white/40">{sub}</div>
      ) : null}
    </div>
  );
}

function HealthPill({ name, ok, detail }: { name: string; ok: boolean; detail?: string }) {
  return (
    <span
      title={detail}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        ok
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
          : "border-rose-500/40 bg-rose-500/15 text-rose-200",
      )}
    >
      {name} {ok ? "OK" : "—"}
    </span>
  );
}

function useEcharts(
  ref: React.RefObject<HTMLDivElement | null>,
  option: echarts.EChartsOption | null,
  deps: unknown[],
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !option) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- option rebuilt when deps change
  }, deps);
}

export function BiDashboard() {
  const { sidebarHidden, setSidebarHidden } = useAdminChrome();
  const [data, setData] = useState<BiOverview | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [clock, setClock] = useState(() => new Date());

  const lineRef = useRef<HTMLDivElement>(null);
  const pieRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(adminBiOverviewUrl(), {
        cache: "no-store",
        headers: apiHeaders(),
      });
      const text = await res.text();
      if (!res.ok) {
        setErr(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      setData(JSON.parse(text) as BiOverview);
      setErr("");
      setLastFetch(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setSidebarHidden(true);
    return () => setSidebarHidden(false);
  }, [setSidebarHidden]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarHidden(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebarHidden]);

  const snapshotsByDay = data?.charts.snapshotsByDay ?? [];
  const trendMix = data?.charts.trendTypeMix ?? [];
  const hot = data?.hotMovers ?? [];

  useEcharts(
    lineRef,
    snapshotsByDay.length
      ? {
          backgroundColor: "transparent",
          textStyle: { color: CHART_TEXT },
          grid: { left: 48, right: 16, top: 28, bottom: 36 },
          tooltip: { trigger: "axis" },
          xAxis: {
            type: "category",
            data: snapshotsByDay.map((d) => d.day.slice(5)),
            axisLine: { lineStyle: { color: CHART_GRID } },
          },
          yAxis: {
            type: "value",
            splitLine: { lineStyle: { color: CHART_GRID } },
          },
          series: [
            {
              type: "line",
              smooth: true,
              data: snapshotsByDay.map((d) => d.count),
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: "rgba(139,92,246,0.35)" },
                  { offset: 1, color: "rgba(139,92,246,0)" },
                ]),
              },
              lineStyle: { color: "#a78bfa", width: 2 },
              itemStyle: { color: "#c4b5fd" },
            },
          ],
        }
      : null,
    [snapshotsByDay],
  );

  useEcharts(
    pieRef,
    trendMix.length
      ? {
          backgroundColor: "transparent",
          textStyle: { color: CHART_TEXT },
          tooltip: { trigger: "item" },
          legend: {
            bottom: 0,
            textStyle: { color: CHART_TEXT, fontSize: 10 },
          },
          series: [
            {
              type: "pie",
              radius: ["42%", "68%"],
              center: ["50%", "44%"],
              data: trendMix.map((t) => ({
                name: t.trendType,
                value: t.count,
              })),
              label: { color: CHART_TEXT, fontSize: 10 },
            },
          ],
        }
      : null,
    [trendMix],
  );

  useEcharts(
    barRef,
    hot.length
      ? {
          backgroundColor: "transparent",
          textStyle: { color: CHART_TEXT },
          grid: { left: 120, right: 24, top: 16, bottom: 28 },
          tooltip: { trigger: "axis" },
          xAxis: {
            type: "value",
            splitLine: { lineStyle: { color: CHART_GRID } },
          },
          yAxis: {
            type: "category",
            data: hot.map((h) => h.canonicalName).reverse(),
            axisLabel: { width: 100, overflow: "truncate", fontSize: 10 },
          },
          series: [
            {
              type: "bar",
              data: hot.map((h) => h.totalRankGain).reverse(),
              itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                  { offset: 0, color: "#06b6d4" },
                  { offset: 1, color: "#8b5cf6" },
                ]),
              },
            },
          ],
        }
      : null,
    [hot],
  );

  const q = data?.kpis.rankingQueue ?? {};

  return (
    <div className="relative min-h-[calc(100svh-4rem)] overflow-hidden rounded-2xl border border-white/10 bg-[#070b14] text-white shadow-2xl">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,255,0.18),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:48px_48px]"
        aria-hidden
      />

      <div className="relative z-10 flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-violet-300/80">
              Ranking Platform
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              运营 BI 大屏
            </h1>
            <p className="mt-1 text-sm text-white/45">
              聚合 KPI · 快照趋势 · 趋势标签 · 涨榜热点 · 依赖健康
              {data?.generatedAt ? (
                <span className="ml-2 font-mono text-xs text-white/35">
                  数据 {new Date(data.generatedAt).toLocaleString("zh-CN")}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg tabular-nums text-cyan-200/90">
              {formatClock(clock)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-white/15 bg-black/40 text-white hover:bg-white/10"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              disabled={loading}
            >
              <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} />
              刷新
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={sidebarHidden}
              className="border-violet-400/40 bg-black/40 text-violet-100"
              onClick={() => setSidebarHidden(!sidebarHidden)}
            >
              {sidebarHidden ? (
                <>
                  <Minimize2 className="mr-1 size-3.5" />
                  退出全屏
                </>
              ) : (
                <>
                  <Maximize2 className="mr-1 size-3.5" />
                  全屏
                </>
              )}
            </Button>
            <Link
              href={ADMIN_HREF.home}
              className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
            >
              系统概览
            </Link>
          </div>
        </header>

        {err ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {err}
          </p>
        ) : null}

        {data ? (
          <>
            <div className="flex flex-wrap gap-2">
              <HealthPill name="PG" ok={data.health.postgresql.ok} />
              <HealthPill name="Redis" ok={data.health.redis.ok} detail={data.health.redis.detail} />
              <HealthPill name="CH" ok={data.health.clickhouse.ok} detail={data.health.clickhouse.detail} />
              <HealthPill
                name="Kafka"
                ok={!data.health.kafka.configured || data.health.kafka.ok}
                detail={data.health.kafka.detail}
              />
              <HealthPill
                name="ES"
                ok={data.health.elasticsearch.ok}
                detail={data.health.elasticsearch.detail}
              />
              {lastFetch ? (
                <span className="text-[11px] text-white/35">
                  上次拉取 {formatClock(lastFetch)} · 每 {REFRESH_MS / 1000}s 自动刷新
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <KpiCard label="话题" value={data.kpis.topics} accent="violet" />
              <KpiCard label="实体" value={data.kpis.entities} accent="cyan" />
              <KpiCard label="快照总数" value={data.kpis.snapshotsTotal} accent="violet" />
              <KpiCard
                label="24h 快照"
                value={data.kpis.snapshotsLast24h}
                accent="emerald"
              />
              <KpiCard
                label="Outbox 待发布"
                value={data.kpis.outboxPending}
                accent={data.kpis.outboxPending > 0 ? "amber" : "emerald"}
              />
              <KpiCard
                label="24h 爬虫任务"
                value={data.kpis.crawlTasksLast24h}
                accent="cyan"
              />
              <KpiCard
                label="今日 AI 分析"
                value={data.kpis.aiAnalysesToday}
                accent="rose"
              />
              <KpiCard
                label="排行队列"
                value={q.running ?? 0}
                sub={`queued ${q.queued ?? 0} · done ${q.completed ?? 0}`}
                accent="amber"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-5">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                  近 14 日快照量
                </h2>
                <div ref={lineRef} className="h-[min(280px,32vh)] w-full min-h-[200px]" />
              </section>
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-3">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                  24h 趋势标签分布
                </h2>
                <div ref={pieRef} className="h-[min(280px,32vh)] w-full min-h-[200px]" />
              </section>
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">
                  涨榜热点 Top10
                </h2>
                <div ref={barRef} className="h-[min(280px,32vh)] w-full min-h-[200px]" />
              </section>
            </div>

            <section className="rounded-xl border border-white/10 bg-black/35 p-3">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/45">
                最新快照
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                      <th scope="col" className="px-2 py-2">
                        时间
                      </th>
                      <th scope="col" className="px-2 py-2">
                        话题
                      </th>
                      <th scope="col" className="px-2 py-2">
                        窗口
                      </th>
                      <th scope="col" className="px-2 py-2">
                        条目
                      </th>
                      <th scope="col" className="px-2 py-2">
                        置信度
                      </th>
                      <th scope="col" className="px-2 py-2">
                        AI
                      </th>
                      <th scope="col" className="px-2 py-2">
                        状态
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSnapshots.map((row) => (
                      <tr
                        key={row.snapshotId}
                        className="border-b border-white/5 hover:bg-white/5"
                      >
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-white/70">
                          {new Date(row.snapshotTime).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-2 py-2">
                          <Link
                            href={snapshotDetailAdminPath(row.snapshotId)}
                            className="text-violet-300 hover:underline"
                          >
                            {row.topicTitle}
                          </Link>
                          <div className="text-[10px] text-white/35">{row.topicSlug}</div>
                        </td>
                        <td className="px-2 py-2 text-xs">{row.timeWindow}</td>
                        <td className="px-2 py-2 tabular-nums">{row.itemCount}</td>
                        <td className="px-2 py-2 tabular-nums">
                          {row.confidenceScore.toFixed(2)}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {row.generatedByAi ? "摘要" : "—"} ({row.aiAnalysisCount})
                        </td>
                        <td className="px-2 py-2 text-xs text-white/50">
                          {row.rankingStatus}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : loading ? (
          <p className="text-center text-white/50">加载 BI 数据…</p>
        ) : null}
      </div>
    </div>
  );
}
