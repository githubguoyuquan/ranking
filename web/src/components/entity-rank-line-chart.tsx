"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";

export type RankHistoryPoint = { asOf: string; rank: number };

export function EntityRankLineChart({ points }: { points: RankHistoryPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length === 0) return;

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#cccccc" },
      grid: { left: 52, right: 20, top: 28, bottom: 52 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: points.map((p) => p.asOf),
        axisLabel: { rotate: 30, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        name: "名次",
        inverse: true,
        min: 1,
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      series: [
        {
          type: "line",
          smooth: true,
          symbolSize: 6,
          data: points.map((p) => p.rank),
          areaStyle: { opacity: 0.07 },
          lineStyle: { width: 2, color: "#7c3aed" },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [points]);

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无历史点</p>;
  }

  return (
    <div
      ref={ref}
      className="h-[min(380px,45vh)] w-full min-h-[240px]"
      aria-label="实体名次随时间变化折线图；纵轴数字越小表示名次越靠前"
    />
  );
}
