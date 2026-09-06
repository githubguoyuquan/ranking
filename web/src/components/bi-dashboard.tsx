"use client";
import { useResourcePolling } from "@/hooks/use-resource-polling";

import { useAdminChrome } from "@/components/admin-chrome-context";
import { Button } from "@/components/ui/button";
import { adminBiOverviewUrl } from "@/lib/backend-api-urls";
import type { BiOverview } from "@/lib/bi-types";
import { ADMIN_HREF, snapshotDetailAdminPath } from "@/lib/admin-web-paths";
import { cn } from "@/lib/utils";
import * as echarts from "echarts";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { BiDrillPanel, type BiDrillTarget } from "@/components/bi-drill-panel";
import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_MS = 30_000;

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}
const CHART_TEXT = "#cccccc";
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
      <div className="text-xs font-medium uppercase tracking-wider text-[#9d9d9d]">
        {label}
      </div>
      <div className="mt-1 font-mono text-[22px] font-semibold tabular-nums text-[#f0f0f0]">
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-xs text-[#858585]">{sub}</div>
      ) : null}
    </div>
  );
}

function HealthPill({ name, ok, detail }: { name: string; ok: boolean; detail?: string }) {
  return (
    <span
      title={detail}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs font-medium",
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
  const [clock, setClock] = useState<Date | null>(null);
  const [drill, setDrill] = useState<BiDrillTarget>(null);

  const lineRef = useRef<HTMLDivElement>(null);
  const pieRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const chRef = useRef<HTMLDivElement>(null);
  const outboxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(adminBiOverviewUrl(), {
        signal,
        cache: "no-store",
        headers: apiHeaders(),
      });
      const text = await res.text();
      if (signal?.aborted) return;
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      setData(JSON.parse(text) as BiOverview);
      setErr("");
      setLastFetch(new Date());
    } catch (e) {
      if (!signal?.aborted) setErr(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const refreshOverview = useResourcePolling(signal => load(signal), { key: "bi-overview", enabled: true, intervalMs: REFRESH_MS });

  useEffect(() => {
    setClock(new Date());
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
  const chTopic = data?.charts.clickhouseTopicPopularity ?? [];
  const outboxTypes = data?.charts.outboxPendingByType ?? [];
  const chByDay = (() => {
    const m = new Map<string, number>();
    for (const r of chTopic) {
      m.set(r.day, (m.get(r.day) ?? 0) + r.avg_value);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const chTopicsForDrill = (() => {
    const m = new Map<number, { title: string; slug: string | null }>();
    for (const r of chTopic) {
      if (!m.has(r.topic_id)) {
        m.set(r.topic_id, {
          title: r.topicTitle ?? `topic ${r.topic_id}`,
          slug: r.topicSlug ?? null,
        });
      }
    }
    return [...m.entries()].slice(0, 8);
  })();

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

  useEcharts(
    chRef,
    chByDay.length
      ? {
          backgroundColor: "transparent",
          textStyle: { color: CHART_TEXT },
          grid: { left: 48, right: 16, top: 28, bottom: 36 },
          tooltip: { trigger: "axis" },
          xAxis: {
            type: "category",
            data: chByDay.map((d) => d[0].slice(5)),
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
              data: chByDay.map((d) => Math.round(d[1] * 100) / 100),
              lineStyle: { color: "#22d3ee", width: 2 },
            },
          ],
        }
      : null,
    [chByDay],
  );

  useEcharts(
    outboxRef,
    outboxTypes.length
      ? {
          backgroundColor: "transparent",
          textStyle: { color: CHART_TEXT },
          grid: { left: 120, right: 24, top: 16, bottom: 28 },
          tooltip: { trigger: "axis" },
          xAxis: { type: "value", splitLine: { lineStyle: { color: CHART_GRID } } },
          yAxis: {
            type: "category",
            data: outboxTypes.map((o) => o.type).reverse(),
            axisLabel: { fontSize: 9, width: 110, overflow: "truncate" },
          },
          series: [
            {
              type: "bar",
              data: outboxTypes.map((o) => o.count).reverse(),
              itemStyle: { color: "#f59e0b" },
            },
          ],
        }
      : null,
    [outboxTypes],
  );

  const q = data?.kpis.rankingQueue ?? {};

  return (
    <div className="relative min-h-[calc(100svh-4rem)] overflow-hidden rounded-2xl border border-white/10 bg-[#1e1e1e] text-[#f0f0f0] shadow-2xl">
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
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#c586c0]">
              Ranking Platform
            </p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight sm:text-[28px]">
              运营 BI 大屏
            </h1>
            <p className="mt-1 text-sm text-[#9d9d9d]">
              全球爬虫 · 亿级检索 · ClickHouse 趋势 · Outbox · 依赖健康
              {data?.generatedAt ? (
                <span className="ml-2 font-mono text-xs text-[#858585]">
                  数据 {new Date(data.generatedAt).toLocaleString("zh-CN")}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg tabular-nums text-[#9cdcfe]">
              {clock ? formatClock(clock) : "—"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-white/15 bg-black/40 text-[#f0f0f0] hover:bg-white/10"
              onClick={() => {
                setLoading(true);
                refreshOverview();
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
              className="border-violet-400/40 bg-black/40 text-[#c586c0]"
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
              className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-[#cccccc] hover:bg-white/10"
            >
              系统概览
            </Link>
          </div>
        </header>

        {data?.sections ? Object.entries(data.sections).filter(([, section]) => section.status !== "ok").map(([key, section]) => (
          <p key={key} role="status" className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-100">
            {({ clickhouseTrend: "趋势图", clickhouseMv: "分析存储", observability: "运维摘要", trends: "趋势告警" } as Record<string, string>)[key] ?? key}
            ：{section.status === "stale" ? "暂时无法更新，显示上次采样" : "暂时不可用"}
            {section.sampledAt ? `（${new Date(section.sampledAt).toLocaleTimeString()}）` : ""}
          </p>
        )) : null}
        {err ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {err}
          </p>
        ) : null}

        {data?.observability?.alerts?.filter((a) => a.severity !== "ok").length ? (
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-200/90">
              运维告警 · {data.observability.status}
            </p>
            <ul className="space-y-1 text-sm text-amber-50/90">
              {data.observability.alerts
                .filter((a) => a.severity !== "ok")
                .map((a) => (
                  <li key={a.code} className="font-mono text-xs">
                    [{a.severity}] {a.message}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        {data?.trends?.alerts?.length ? (
          <div className="space-y-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-orange-200/90">
              趋势异常 · {data.trends.status} · 扫描 {data.trends.scannedAnalyses} 条分析
            </p>
            <ul className="space-y-1 text-sm text-orange-50/90">
              {data.trends.alerts.map((a) => (
                <li key={`${a.code}-${a.entityId ?? a.topicId ?? a.message}`} className="font-mono text-xs">
                  [{a.severity}] {a.message}
                </li>
              ))}
            </ul>
          </div>
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
                <span className="text-xs text-[#858585]">
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
              <KpiCard
                label="调度信源"
                value={data.kpis.scheduleEnabledSources ?? 0}
                sub={`24h 调度 ${data.kpis.scheduleRuns24h ?? 0} 次`}
                accent="cyan"
              />
              <KpiCard
                label="主检索"
                value={data.kpis.searchPrimary ?? "—"}
                sub={
                  data.searchScale?.elasticsearch?.useWriteAlias
                    ? "ES 写别名"
                    : "PG/ES/Qdrant"
                }
                accent="violet"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-5">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9d9d9d]">
                  近 14 日快照量
                </h2>
                <div ref={lineRef} className="h-[min(280px,32vh)] w-full min-h-[200px]" />
              </section>
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-3">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9d9d9d]">
                  24h 趋势标签分布
                </h2>
                <div ref={pieRef} className="h-[min(280px,32vh)] w-full min-h-[200px]" />
              </section>
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9d9d9d]">
                  涨榜热点 Top10
                </h2>
                <div ref={barRef} className="h-[min(280px,32vh)] w-full min-h-[200px]" />
                <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs">
                  {hot.map((h) => (
                    <li key={h.entityId}>
                      <button
                        type="button"
                        className="text-[#9cdcfe] hover:underline"
                        onClick={() =>
                          setDrill({
                            kind: "entity",
                            id: h.entityId,
                            label: h.canonicalName,
                          })
                        }
                      >
                        {h.canonicalName} (+{h.totalRankGain})
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-5">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9d9d9d]">
                  ClickHouse 话题热度
                  {data.charts.clickhouseMv ? (
                    <span className="ml-2 font-normal normal-case text-[#858585]">
                      MV {data.charts.clickhouseMv.mvExists ? "OK" : "缺失"}
                    </span>
                  ) : null}
                </h2>
                <div ref={chRef} className="h-[min(240px,28vh)] w-full min-h-[180px]" />
                {chTopicsForDrill.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {chTopicsForDrill.map(([tid, meta]) => (
                      <button
                        key={tid}
                        type="button"
                        className="rounded border border-cyan-500/30 px-2 py-0.5 text-xs text-[#9cdcfe] hover:bg-cyan-500/10"
                        onClick={() =>
                          setDrill({
                            kind: "topic",
                            id: String(tid),
                            label: meta.title,
                          })
                        }
                      >
                        {meta.slug ?? tid}
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-4">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9d9d9d]">
                  Outbox 待发布
                </h2>
                <div ref={outboxRef} className="h-[min(240px,28vh)] w-full min-h-[180px]" />
              </section>
              <section className="rounded-xl border border-white/10 bg-black/35 p-3 lg:col-span-3 text-sm text-[#b4b4b4]">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9d9d9d]">
                  全球爬虫
                </h2>
                <p>
                  调度 {data.crawlGlobal?.scheduler ? (data.crawlGlobal.scheduler.enabled ? "开启" : "关闭") : "暂时不可用"}
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {(data.crawlGlobal?.sourcesByRegion ?? []).map((r) => (
                    <li key={r.region}>
                      {r.region}: {r.count}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className="rounded-xl border border-white/10 bg-black/35 p-3">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9d9d9d]">
                最新快照
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-[#858585]">
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
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-[#cccccc]">
                          {new Date(row.snapshotTime).toLocaleString("zh-CN")}
                        </td>
                        <td className="px-2 py-2">
                          <Link
                            href={snapshotDetailAdminPath(row.snapshotId)}
                            className="text-[#c586c0] hover:underline"
                          >
                            {row.topicTitle}
                          </Link>
                          <div className="text-xs text-[#858585]">{row.topicSlug}</div>
                        </td>
                        <td className="px-2 py-2 text-xs">{row.timeWindow}</td>
                        <td className="px-2 py-2 tabular-nums">{row.itemCount}</td>
                        <td className="px-2 py-2 tabular-nums">
                          {row.confidenceScore.toFixed(2)}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {row.generatedByAi ? "摘要" : "—"} ({row.aiAnalysisCount})
                        </td>
                        <td className="px-2 py-2 text-xs text-[#9d9d9d]">
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
          <p className="text-center text-[#9d9d9d]">加载 BI 数据…</p>
        ) : null}
      </div>
      <BiDrillPanel target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
