"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";

export type TopicRankSeries = {
  topicSlug: string;
  points: Array<{ asOf: string; rank: number }>;
};

const COLORS = ["#7c3aed", "#0891b2", "#ea580c", "#16a34a", "#db2777", "#ca8a04"];

export function EntityMultiTopicRankChart({ series }: { series: TopicRankSeries[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const withPoints = series.filter((s) => s.points.length > 0);

  useEffect(() => {
    const el = ref.current;
    if (!el || withPoints.length === 0) return;

    const allTimes = [
      ...new Set(withPoints.flatMap((s) => s.points.map((p) => p.asOf))),
    ].sort();

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#a1a1aa" },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 52, right: 20, top: 36, bottom: 52 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: allTimes,
        axisLabel: { rotate: 30, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        name: "名次",
        inverse: true,
        min: 1,
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      series: withPoints.map((s, i) => {
        const byTime = new Map(s.points.map((p) => [p.asOf, p.rank]));
        return {
          name: s.topicSlug,
          type: "line",
          smooth: true,
          symbolSize: 5,
          connectNulls: false,
          data: allTimes.map((t) => byTime.get(t) ?? null),
          lineStyle: { width: 2, color: COLORS[i % COLORS.length] },
        };
      }),
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [withPoints]);

  if (withPoints.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无跨话题历史点</p>;
  }

  return (
    <div
      ref={ref}
      className="h-[min(420px,50vh)] w-full min-h-[260px]"
      aria-label="实体在多个话题下的名次折线图"
    />
  );
}
