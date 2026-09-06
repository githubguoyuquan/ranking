"use client";

import {
  adminBiDrillEntityUrl,
  adminBiDrillTopicUrl,
} from "@/lib/backend-api-urls";
import { cn } from "@/lib/utils";
import * as echarts from "echarts";
import { X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const CHART_TEXT = "#cccccc";
const CHART_GRID = "rgba(148,163,184,0.08)";

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}

export type BiDrillTarget =
  | { kind: "entity"; id: string; label: string }
  | { kind: "topic"; id: string; label: string }
  | null;

type EntityDrill = {
  entity?: { canonicalName: string; type: string } | null;
  sparkline: Array<{ ts: string; value: number }>;
};

type TopicDrill = {
  topic?: { slug: string; title: string } | null;
  rows: Array<{
    day: string;
    metric_key: string;
    avg_value: number;
    sample_count: number;
  }>;
};

export function BiDrillPanel({
  target,
  onClose,
}: {
  target: BiDrillTarget;
  onClose: () => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [entityData, setEntityData] = useState<EntityDrill | null>(null);
  const [topicData, setTopicData] = useState<TopicDrill | null>(null);

  const load = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    setErr("");
    try {
      const url =
        target.kind === "entity"
          ? adminBiDrillEntityUrl(target.id)
          : adminBiDrillTopicUrl(target.id);
      const res = await fetch(url, { cache: "no-store", headers: apiHeaders() });
      const text = await res.text();
      if (!res.ok) {
        setErr(`HTTP ${res.status}: ${text.slice(0, 180)}`);
        return;
      }
      const json = JSON.parse(text) as Record<string, unknown>;
      if (target.kind === "entity") {
        setEntityData({
          entity: json.entity as EntityDrill["entity"],
          sparkline: (json.sparkline as EntityDrill["sparkline"]) ?? [],
        });
        setTopicData(null);
      } else {
        setTopicData({
          topic: json.topic as TopicDrill["topic"],
          rows: (json.rows as TopicDrill["rows"]) ?? [],
        });
        setEntityData(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartOption: echarts.EChartsOption | null = (() => {
    if (target?.kind === "entity" && entityData?.sparkline.length) {
      const pts = entityData.sparkline;
      return {
        backgroundColor: "transparent",
        textStyle: { color: CHART_TEXT },
        grid: { left: 44, right: 12, top: 20, bottom: 32 },
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "category",
          data: pts.map((p) => p.ts.slice(5, 16)),
          axisLine: { lineStyle: { color: CHART_GRID } },
        },
        yAxis: {
          type: "value",
          inverse: true,
          splitLine: { lineStyle: { color: CHART_GRID } },
        },
        series: [
          {
            type: "line",
            smooth: true,
            data: pts.map((p) => p.value),
            lineStyle: { color: "#a78bfa", width: 2 },
          },
        ],
      };
    }
    if (target?.kind === "topic" && topicData?.rows.length) {
      const pop = topicData.rows.filter((r) => r.metric_key === "ranking.popularity_score");
      const byDay = new Map<string, number>();
      for (const r of pop) {
        byDay.set(r.day, r.avg_value);
      }
      const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      return {
        backgroundColor: "transparent",
        textStyle: { color: CHART_TEXT },
        grid: { left: 44, right: 12, top: 20, bottom: 32 },
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "category",
          data: days.map((d) => d[0].slice(5)),
          axisLine: { lineStyle: { color: CHART_GRID } },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: CHART_GRID } },
        },
        series: [
          {
            type: "bar",
            data: days.map((d) => Math.round(d[1] * 100) / 100),
            itemStyle: { color: "#22d3ee" },
          },
        ],
      };
    }
    return null;
  })();

  useEffect(() => {
    const el = chartRef.current;
    if (!el || !chartOption) return;
    const chart = echarts.init(el);
    chart.setOption(chartOption);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [chartOption]);

  if (!target) return null;

  return (
    <aside
      className={cn(
        "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/15 bg-[#0a0f1a]/95 p-4 shadow-2xl backdrop-blur-md",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <DrillHeader target={target} />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-white/15 p-1 text-[#cccccc] hover:bg-white/10"
          aria-label="关闭钻取"
        >
          <X className="size-4" />
        </button>
      </div>
      {loading ? <p className="text-sm text-[#9d9d9d]">加载钻取数据…</p> : null}
      {err ? (
        <p className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-sm text-rose-100">
          {err}
        </p>
      ) : null}
      <div className="mb-3 text-sm text-[#b4b4b4]">
        {target.kind === "entity" && entityData?.entity ? (
          <p>
            {entityData.entity.canonicalName} · {entityData.entity.type}
          </p>
        ) : null}
        {target.kind === "topic" && topicData?.topic ? (
          <p>
            {topicData.topic.title}{" "}
            <span className="text-[#858585]">({topicData.topic.slug})</span>
          </p>
        ) : null}
        {target.kind === "entity" ? (
          <Link
            href={`/entities/rank-history?entityId=${encodeURIComponent(target.id)}`}
            className="mt-1 inline-block text-xs text-[#c586c0] hover:underline"
          >
            PG 榜位历史 →
          </Link>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {chartOption ? (
          <div ref={chartRef} className="h-[min(320px,50vh)] w-full" />
        ) : (
          <p className="text-sm text-[#858585]">暂无 ClickHouse 时序数据</p>
        )}
      </div>
    </aside>
  );
}

function DrillHeader({ target }: { target: NonNullable<BiDrillTarget> }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#c586c0]">
        BI 钻取 · {target.kind === "entity" ? "实体榜位" : "话题 MV"}
      </p>
      <h2 className="text-lg font-semibold text-[#f0f0f0]">{target.label}</h2>
      <p className="font-mono text-xs text-[#858585]">id {target.id}</p>
    </div>
  );
}
