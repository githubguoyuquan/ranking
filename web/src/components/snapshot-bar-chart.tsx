"use client";

import * as echarts from "echarts";
import { unifiedSearchAdminPathFromQuery } from "@/lib/unified-search-admin-path";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export type SnapshotChartItem = {
  rank: number;
  popularityScore?: number;
  entity?: { canonicalName?: string | null } | null;
};

export function SnapshotBarChart({ items }: { items: SnapshotChartItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const el = ref.current;
    if (!el || items.length === 0) return;

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const sorted = [...items].sort((a, b) => a.rank - b.rank);
    chart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#a1a1aa" },
      grid: { left: 100, right: 32, top: 24, bottom: 24 },
      xAxis: {
        type: "value",
        name: "分数",
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      yAxis: {
        type: "category",
        data: sorted.map(
          (i) => i.entity?.canonicalName?.trim() || `#${i.rank}`,
        ),
        inverse: true,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
      },
      series: [
        {
          type: "bar",
          cursor: "pointer",
          data: sorted.map((i) => i.popularityScore ?? 0),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: "#7c3aed" },
              { offset: 1, color: "#a78bfa" },
            ]),
            borderRadius: [0, 6, 6, 0],
          },
        },
      ],
    });

    const onClick = (raw: unknown) => {
      const p = raw as {
        componentType?: string;
        seriesType?: string;
        dataIndex?: number;
      };
      if (p.componentType !== "series" || p.seriesType !== "bar") return;
      const idx = p.dataIndex;
      if (typeof idx !== "number" || idx < 0 || idx >= sorted.length) return;
      const name = sorted[idx]?.entity?.canonicalName?.trim();
      if (!name) return;
      router.push(unifiedSearchAdminPathFromQuery(name));
    };
    chart.on("click", onClick);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      chart.off("click", onClick);
      ro.disconnect();
      chart.dispose();
    };
  }, [items, router]);

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">暂无榜单条目</p>
    );
  }

  return (
    <div
      ref={ref}
      className="h-[min(420px,50vh)] w-full min-h-[280px]"
      aria-label="得分分布柱状图：横向为分数，纵向为实体；鼠标点击柱条可打开该实体的聚合搜索"
    />
  );
}
