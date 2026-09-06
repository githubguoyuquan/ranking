"use client";
import { useResourcePolling } from "@/hooks/use-resource-polling";
import { queryJson, adminApiHeaders } from "@/lib/query-http";
import { apiUrl } from "@/lib/api";

import { useAdminChrome } from "@/components/admin-chrome-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CRAWL_SOURCES_LIST_LIMIT_DEFAULT,
  CRAWL_SOURCE_URLS_PREVIEW_LIMIT,
  HTTP_URL_INPUT_MAX_LEN,
} from "@/lib/admin-input-limits";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import { adminCrawlOverviewUrl } from "@/lib/backend-api-urls";
import { isDecimalBigIntIdString } from "@/lib/decimal-id";
import {
  nestCrawlSourcesListUrl,
  nestCrawlTasksUrl,
} from "@/lib/nest-api-urls";
import { cn } from "@/lib/utils";
import { Maximize2, Minimize2 } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type SourceRow = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
};

type CrawledUrlRow = {
  id: string;
  url: string;
  status?: string;
  fetchedAt?: string | null;
  pageTitle?: string | null;
  domHint?: string | null;
};

type CrawlTaskBrief = {
  id: string;
  sourceId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  source?: { name?: string; kind?: string };
};

type CrawlTaskRow = {
  id: string;
  status: string;
  sourceId?: string;
  cursor?: string | null;
};

type LogKind = "pulse" | "ingest" | "task" | "warn" | "ops";

type LogLine = { id: string; t: number; kind: LogKind; msg: string };

const MAX_LOG = 100;
const POLL_HYPER_MS = 3000;
const POLL_CALM_MS = 10000;

function parseSourcesJson(text: string): SourceRow[] {
  try {
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: SourceRow[] = [];
    for (const x of arr) {
      if (typeof x !== "object" || x === null) continue;
      const o = x as Record<string, unknown>;
      if (o.id == null) continue;
      out.push({
        id: String(o.id),
        name: o.name != null ? String(o.name) : "",
        kind: o.kind != null ? String(o.kind) : "",
        baseUrl: o.baseUrl != null ? String(o.baseUrl) : "",
      });
    }
    return out;
  } catch {
    return [];
  }
}

type CrawlOverview = {
  sources: number;
  scheduledSources: number;
  tasks: { running: number; failed: number; queued?: number };
  urlsByStatus: Record<string, number>;
  features: {
    httpFetch?: boolean;
    playwright?: boolean;
    followLinks?: boolean;
    semanticDedup?: boolean;
    crossSourceDedup?: boolean;
    domFeatures?: boolean;
    respectRobots?: boolean;
  };
  linkPolicy?: {
    maxDepth?: number;
    maxUrlsPerTask?: number;
    allowHosts?: string[];
    respectRobots?: boolean;
  };
  worker?: {
    queueName?: string;
    queueShard?: string | null;
    scheduledRegions?: string[];
  };
  scheduler?: {
    sla?: { healthy?: boolean; staleAfterMinutes?: number };
  };
};

function parseOverviewJson(text: string): CrawlOverview | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const tasks =
      typeof o.tasks === "object" && o.tasks !== null
        ? (o.tasks as Record<string, unknown>)
        : {};
    const features =
      typeof o.features === "object" && o.features !== null
        ? (o.features as Record<string, unknown>)
        : {};
    const urlsByStatus =
      typeof o.urlsByStatus === "object" && o.urlsByStatus !== null
        ? (o.urlsByStatus as Record<string, unknown>)
        : {};
    const linkPolicy =
      typeof o.linkPolicy === "object" && o.linkPolicy !== null
        ? (o.linkPolicy as Record<string, unknown>)
        : {};
    const worker =
      typeof o.worker === "object" && o.worker !== null
        ? (o.worker as Record<string, unknown>)
        : {};
    const scheduler =
      typeof o.scheduler === "object" && o.scheduler !== null
        ? (o.scheduler as Record<string, unknown>)
        : {};
    const sla =
      typeof scheduler.sla === "object" && scheduler.sla !== null
        ? (scheduler.sla as Record<string, unknown>)
        : {};
    return {
      sources: typeof o.sources === "number" ? o.sources : 0,
      scheduledSources:
        typeof o.scheduledSources === "number" ? o.scheduledSources : 0,
      tasks: {
        running: typeof tasks.running === "number" ? tasks.running : 0,
        failed: typeof tasks.failed === "number" ? tasks.failed : 0,
        queued: typeof tasks.queued === "number" ? tasks.queued : undefined,
      },
      urlsByStatus: Object.fromEntries(
        Object.entries(urlsByStatus).map(([k, v]) => [k, Number(v) || 0]),
      ),
      features: {
        httpFetch: features.httpFetch === true,
        playwright: features.playwright === true,
        followLinks: features.followLinks === true,
        semanticDedup: features.semanticDedup === true,
        crossSourceDedup: features.crossSourceDedup === true,
        domFeatures: features.domFeatures === true,
        respectRobots: features.respectRobots === true,
      },
      linkPolicy: {
        maxDepth:
          typeof linkPolicy.maxDepth === "number"
            ? linkPolicy.maxDepth
            : undefined,
        maxUrlsPerTask:
          typeof linkPolicy.maxUrlsPerTask === "number"
            ? linkPolicy.maxUrlsPerTask
            : undefined,
        allowHosts: Array.isArray(linkPolicy.allowHosts)
          ? linkPolicy.allowHosts.map(String)
          : undefined,
        respectRobots: linkPolicy.respectRobots === true,
      },
      worker: {
        queueName:
          typeof worker.queueName === "string" ? worker.queueName : undefined,
        queueShard:
          worker.queueShard != null ? String(worker.queueShard) : null,
        scheduledRegions: Array.isArray(worker.scheduledRegions)
          ? worker.scheduledRegions.map(String)
          : undefined,
      },
      scheduler: {
        sla: {
          healthy: sla.healthy === true,
          staleAfterMinutes:
            typeof sla.staleAfterMinutes === "number"
              ? sla.staleAfterMinutes
              : undefined,
        },
      },
    };
  } catch {
    return null;
  }
}

function domHintFromFeatures(raw: unknown): string | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const meta =
    typeof o.metaDescription === "string" ? o.metaDescription.trim() : "";
  if (meta) return meta.slice(0, 80);
  const og = typeof o.ogTitle === "string" ? o.ogTitle.trim() : "";
  if (og) return og.slice(0, 80);
  return null;
}

function parseUrlsJson(text: string): CrawledUrlRow[] {
  try {
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: CrawledUrlRow[] = [];
    for (const x of arr) {
      if (typeof x !== "object" || x === null) continue;
      const o = x as Record<string, unknown>;
      if (o.id == null || o.url == null) continue;
      out.push({
        id: String(o.id),
        url: String(o.url),
        status: o.status != null ? String(o.status) : undefined,
        fetchedAt:
          o.fetchedAt != null ? String(o.fetchedAt) : null,
        pageTitle: o.pageTitle != null ? String(o.pageTitle) : null,
        domHint: domHintFromFeatures(o.domFeaturesJson),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function parseTasksListJson(text: string): CrawlTaskBrief[] {
  try {
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: CrawlTaskBrief[] = [];
    for (const x of arr) {
      if (typeof x !== "object" || x === null) continue;
      const o = x as Record<string, unknown>;
      if (o.id == null || o.sourceId == null || o.status == null) continue;
      const source =
        typeof o.source === "object" && o.source !== null
          ? (o.source as Record<string, unknown>)
          : undefined;
      out.push({
        id: String(o.id),
        sourceId: String(o.sourceId),
        status: String(o.status),
        createdAt: o.createdAt != null ? String(o.createdAt) : undefined,
        updatedAt: o.updatedAt != null ? String(o.updatedAt) : undefined,
        source: source
          ? {
              name: source.name != null ? String(source.name) : undefined,
              kind: source.kind != null ? String(source.kind) : undefined,
            }
          : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function parseTaskJson(text: string): CrawlTaskRow | null {
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (o.id == null || o.status == null) return null;
    return {
      id: String(o.id),
      status: String(o.status),
      sourceId: o.sourceId != null ? String(o.sourceId) : undefined,
      cursor: o.cursor != null ? String(o.cursor) : null,
    };
  } catch {
    return null;
  }
}

function formatClock(d: number) {
  return new Date(d).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatShortTaskTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function EngineSwitch(props: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accent: "cyan" | "fuchsia" | "amber";
}) {
  const { id, label, hint, checked, onChange, accent } = props;
  const ring =
    accent === "cyan"
      ? "focus-visible:ring-cyan-400/50"
      : accent === "fuchsia"
        ? "focus-visible:ring-fuchsia-400/50"
        : "focus-visible:ring-amber-400/50";
  const on =
    accent === "cyan"
      ? "border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_24px_oklch(0.72_0.14_195_/_0.35)]"
      : accent === "fuchsia"
        ? "border-fuchsia-400/55 bg-fuchsia-500/12 shadow-[0_0_24px_oklch(0.7_0.2_320_/_0.35)]"
        : "border-amber-400/55 bg-amber-500/12 shadow-[0_0_20px_oklch(0.78_0.16_85_/_0.3)]";
  const off = "border-white/15 bg-black/30 hover:border-white/25";

  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-300",
        checked ? on : off,
        "focus-visible:outline-none focus-visible:ring-2",
        ring,
      )}
    >
      <span
        className={cn(
          "mt-0.5 h-6 w-11 shrink-0 rounded-full border border-white/20 p-0.5 transition-all duration-300",
          checked ? "bg-white/10" : "bg-black/40",
        )}
      >
        <span
          className={cn(
            "block h-5 w-5 rounded-full bg-gradient-to-br shadow-md transition-all duration-300",
            checked
              ? "translate-x-5 from-cyan-300 to-fuchsia-500"
              : "translate-x-0 from-zinc-500 to-zinc-700",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold tracking-wide text-[#f0f0f0]">
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-[#b4b4b4]">
          {hint}
        </span>
      </span>
    </button>
  );
}

export function CrawlMonitorDashboard() {
  const { sidebarHidden, setSidebarHidden } = useAdminChrome();

  const [liveRelay, setLiveRelay] = useState(true);
  const [hyperSync, setHyperSync] = useState(false);
  const [spectralHud, setSpectralHud] = useState(true);
  const [auxRaster, setAuxRaster] = useState(true);

  useEffect(() => {
    if (!sidebarHidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarHidden(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarHidden, setSidebarHidden]);

  const [sources, setSources] = useState<SourceRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [urlRows, setUrlRows] = useState<CrawledUrlRow[]>([]);
  const [recentTasks, setRecentTasks] = useState<CrawlTaskBrief[]>([]);
  const [lastApiPulse, setLastApiPulse] = useState<number | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [sourcesError, setSourcesError] = useState(false);
  const [overview, setOverview] = useState<CrawlOverview | null>(null);

  const [taskWatchId, setTaskWatchId] = useState("");
  const [taskView, setTaskView] = useState<CrawlTaskRow | null>(null);

  const [dispatchSourceId, setDispatchSourceId] = useState("");
  const [dispatchSeed, setDispatchSeed] = useState("https://example.com/");
  const [dispatchAsync, setDispatchAsync] = useState(true);
  const [dispatchBusy, setDispatchBusy] = useState(false);

  const [log, setLog] = useState<LogLine[]>([]);
  const resolvedSourceId = useRef("");
  const seenUrlIds = useRef<Set<string>>(new Set());
  const prevTaskStatus = useRef<string | null>(null);
  const pushLog = useCallback((msg: string, kind: LogKind = "pulse") => {
    setLog((prev) => {
      const row: LogLine = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        t: Date.now(),
        kind,
        msg,
      };
      const next = [row, ...prev];
      return next.slice(0, MAX_LOG);
    });
  }, []);

  const activeTasks = recentTasks.some(t => t.status === "queued" || t.status === "running");
  const pollMs = hyperSync || activeTasks ? POLL_HYPER_MS : POLL_CALM_MS;
  const selectedKey = selectedSourceId.trim();
  const watchedKey = taskWatchId.trim();
  const watchedComplete = taskView?.id === watchedKey && ["completed", "failed"].includes(taskView.status ?? "");

  const refreshMonitor = useResourcePolling(async signal => {
    const q = new URLSearchParams({ urlsLimit: String(Math.min(CRAWL_SOURCE_URLS_PREVIEW_LIMIT, 50)), tasksLimit: "12" });
    const sid = selectedKey || resolvedSourceId.current;
    if (sid) q.set("sourceId", sid);
    if (isDecimalBigIntIdString(watchedKey) && !watchedComplete) q.set("watchTaskId", watchedKey);
    try {
      const result = await queryJson<{
        selectedSource: { id: string; name: string } | null;
        urls: { status: string; data: CrawledUrlRow[] | null };
        tasks: { status: string; data: CrawlTaskBrief[] | null };
        watchedTask?: { data: CrawlTaskRow | null };
        meta: { partial: boolean };
      }>(apiUrl(`/admin/crawl/monitor?${q}`), signal);
      if (signal.aborted) return;
      if (resolvedSourceId.current !== (result.selectedSource?.id ?? "")) {
        setUrlRows([]); setRecentTasks([]); seenUrlIds.current = new Set();
      }
      resolvedSourceId.current = result.selectedSource?.id ?? "";
      setApiError(result.meta.partial ? "部分动态数据暂时不可用，保留上次结果。" : null);
      if (result.urls.data) {
        const nextIds = new Set(result.urls.data.map(r => r.id));
        for (const row of result.urls.data) {
          if (seenUrlIds.current.size && !seenUrlIds.current.has(row.id)) pushLog(`INGEST 新 URL #${row.id} · ${row.status ?? "?"}`, "ingest");
        }
        seenUrlIds.current = nextIds;
        setUrlRows(result.urls.data);
      }
      if (result.tasks.data) setRecentTasks(result.tasks.data);
      if (result.watchedTask?.data) {
        const task = result.watchedTask.data;
        if (prevTaskStatus.current && prevTaskStatus.current !== task.status) pushLog(`TASK #${task.id} → ${task.status}`, "task");
        prevTaskStatus.current = task.status;
        setTaskView(task);
      } else if (!watchedKey) setTaskView(null);
      setLastApiPulse(Date.now());
      if (result.meta.partial) throw new Error("部分动态数据暂时不可用，保留上次结果。");
    } catch (error) {
      if (!signal.aborted) {
        if (!selectedKey && error instanceof Error && error.message.includes("404")) resolvedSourceId.current = "";
        setApiError(error instanceof Error ? error.message : "动态数据加载失败");
      }
      throw error;
    }
  }, { key: `monitor:${selectedKey}:${watchedKey}`, enabled: liveRelay, intervalMs: pollMs });

  const refreshOverview = useResourcePolling(async signal => {
    try {
      const result = await queryJson<unknown>(adminCrawlOverviewUrl(), signal);
      if (!signal.aborted) { setOverview(parseOverviewJson(JSON.stringify(result))); setOverviewError(false); }
    } catch (error) { if (!signal.aborted) setOverviewError(true); throw error; }
  }, { key: "crawl-overview", enabled: liveRelay, intervalMs: 20000 });

  useResourcePolling(async signal => {
    try {
      const result = await queryJson<unknown>(nestCrawlSourcesListUrl(CRAWL_SOURCES_LIST_LIMIT_DEFAULT), signal);
      if (!signal.aborted) { setSources(parseSourcesJson(JSON.stringify(result))); setSourcesError(false); }
    } catch (error) { if (!signal.aborted) setSourcesError(true); throw error; }
  }, { key: "crawl-sources", enabled: liveRelay, intervalMs: 60000 });

  useEffect(() => {
    if (sources.length && !dispatchSourceId.trim()) {
      setDispatchSourceId(sources[0].id);
    }
  }, [sources, dispatchSourceId]);

  async function fireTask() {
    const sid = dispatchSourceId.trim();
    const seed = dispatchSeed.trim();
    if (!sid || !isDecimalBigIntIdString(sid)) {
      pushLog("发射中止 · sourceId 须为有效数字", "warn");
      return;
    }
    if (!seed || seed.length < 4) {
      pushLog("发射中止 · seedUrl 过短", "warn");
      return;
    }
    setDispatchBusy(true);
    pushLog(`OPS 请求入轨 · source ${sid} · async=${dispatchAsync}`, "ops");
    try {
      const res = await fetch(nestCrawlTasksUrl(), {
        method: "POST",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: sid,
          async: dispatchAsync,
          seedUrls: [seed],
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        pushLog(`OPS 拒绝 · HTTP ${res.status} ${text.slice(0, 120)}`, "warn");
        return;
      }
      refreshMonitor();
      refreshOverview();
      const task = parseTaskJson(text);
      if (task?.id) {
        setTaskWatchId(task.id);
        pushLog(`OPS 任务已签发 #${task.id} · ${task.status}`, "ops");
      } else {
        pushLog(`OPS 响应已接收（解析简略）`, "ops");
      }
    } catch (e) {
      pushLog(
        `OPS 异常 · ${e instanceof Error ? e.message : String(e)}`,
        "warn",
      );
    } finally {
      setDispatchBusy(false);
    }
  }

  const metrics = useMemo(() => {
    const fetched = urlRows.filter((r) => r.status === "fetched").length;
    const reg = urlRows.filter((r) => r.status === "registered").length;
    return { fetched, reg, total: urlRows.length };
  }, [urlRows]);

  const logColor = (k: LogKind) => {
    switch (k) {
      case "ingest":
        return "text-[#4ec9b0]";
      case "task":
        return "text-[#c586c0]";
      case "warn":
        return "text-[#dcdcaa]/95";
      case "ops":
        return "text-emerald-300/95";
      default:
        return "text-sky-200/80";
    }
  };

  return (
    <div
      className={cn(
        "crawl-monitor-deck relative overflow-hidden rounded-2xl border border-cyan-500/25 bg-[#1e1e1e] text-sm shadow-[0_0_60px_oklch(0.55_0.2_260_/_0.08)]",
        auxRaster && "crawl-monitor-aux",
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: `linear-gradient(oklch(0.72 0.14 195 / 0.25) 1px, transparent 1px), linear-gradient(90deg, oklch(0.72 0.14 195 / 0.25) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
          animation: "crawl-grid-drift 28s linear infinite",
        }}
      />
      <div
        className="pointer-events-none absolute -left-1/4 top-1/3 h-[120%] w-1/2 rotate-12 bg-gradient-to-r from-transparent via-fuchsia-500/10 to-transparent"
        style={{
          animation: "crawl-data-shimmer 7s ease-in-out infinite",
          backgroundSize: "200% 100%",
        }}
      />
      {spectralHud ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 opacity-30"
          style={{
            background:
              "linear-gradient(to bottom, transparent, oklch(0.7 0.2 195 / 0.12), transparent)",
            animation: "crawl-scanline 5.5s ease-in-out infinite",
          }}
        />
      ) : null}

      <div className="relative z-20 space-y-6 p-5 md:p-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.35em] text-[#4ec9b0]">
              Crawl Nexus · Live
            </p>
            <h1 className="mt-2 bg-gradient-to-r from-cyan-200 via-white to-fuchsia-300 bg-clip-text text-[22px] font-bold tracking-tight text-transparent md:text-[28px]">
              爬虫引擎监控甲板
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#b4b4b4]">
              实时汇聚{" "}
              <code className="rounded bg-white/10 px-1 text-xs text-[#9cdcfe]">
                GET /v1/crawl/sources
              </code>{" "}
              与{" "}
              <code className="rounded bg-white/10 px-1 text-xs text-[#9cdcfe]">
                …/urls
              </code>
              ；可在此入轨异步任务并追踪状态。区别于「概览」的全站健康面板。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={sidebarHidden}
              title="隐藏应用侧栏以扩大监控区域；按 Esc 退出"
              onClick={() => setSidebarHidden(!sidebarHidden)}
              className="shrink-0 border-cyan-400/45 bg-black/45 text-[#9cdcfe] shadow-[0_0_16px_oklch(0.65_0.15_195_/_0.25)] hover:bg-cyan-500/15"
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
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                liveRelay
                  ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                  : "border-white/20 bg-black/40 text-[#9d9d9d]",
              )}
            >
              {liveRelay ? "遥测中继 · ON" : "遥测中继 · STANDBY"}
            </span>
            <span className="rounded-full border border-white/15 bg-black/35 px-3 py-1 text-xs text-[#b4b4b4]">
              Δt {pollMs}ms
            </span>
            {lastApiPulse ? (
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-[#9cdcfe]">
                最后脉冲 {formatClock(lastApiPulse)}
              </span>
            ) : null}
            <Link
              href={ADMIN_HREF.crawl}
              className="rounded-full border border-fuchsia-500/35 bg-fuchsia-500/10 px-3 py-1 text-xs font-medium text-[#c586c0] underline-offset-4 hover:underline"
            >
              经典爬虫表单 →
            </Link>
          </div>
        </header>

        {overview ? (
          <section className="grid gap-3 rounded-xl border border-cyan-500/20 bg-black/35 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-[#858585]">
                全站概览
              </p>
              <p className="mt-1 font-mono text-sm text-[#9cdcfe]">
                {overview.sources} 源 · {overview.scheduledSources} 定时
              </p>
              <p className="text-xs text-[#9d9d9d]">
                任务 running {overview.tasks.running} · failed{" "}
                {overview.tasks.failed}
                {overview.tasks.queued != null
                  ? ` · queued ${overview.tasks.queued}`
                  : ""}
              </p>
              {overview.scheduler?.sla?.healthy === false ? (
                <p className="mt-1 text-xs text-[#dcdcaa]">
                  调度 SLA 异常（超过{" "}
                  {overview.scheduler.sla.staleAfterMinutes ?? "?"} 分钟未 tick）
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-[#858585]">
                URL 状态
              </p>
              <p className="mt-1 font-mono text-xs leading-relaxed text-[#cccccc]">
                {Object.entries(overview.urlsByStatus).length === 0
                  ? "—"
                  : Object.entries(overview.urlsByStatus)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(" · ")}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wider text-[#858585]">
                运行时特性 / 链接策略
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(
                  [
                    ["HTTP", overview.features.httpFetch],
                    ["Playwright", overview.features.playwright],
                    ["DOM", overview.features.domFeatures],
                    ["Follow", overview.features.followLinks],
                    ["Robots", overview.features.respectRobots],
                    ["SemDedup", overview.features.semanticDedup],
                    ["XSrcDedup", overview.features.crossSourceDedup],
                  ] as const
                ).map(([label, on]) => (
                  <span
                    key={label}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs font-medium",
                      on
                        ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                        : "border-white/15 bg-black/40 text-[#858585]",
                    )}
                  >
                    {label} {on ? "ON" : "off"}
                  </span>
                ))}
              </div>
              {overview.features.followLinks ? (
                <p className="mt-2 text-xs text-[#9d9d9d]">
                  depth≤{overview.linkPolicy?.maxDepth ?? "?"}{" "}
                  · max {overview.linkPolicy?.maxUrlsPerTask ?? "?"} URLs/task
                  {overview.linkPolicy?.allowHosts?.length
                    ? ` · +hosts ${overview.linkPolicy.allowHosts.join(", ")}`
                    : ""}
                </p>
              ) : null}
              {overview.worker?.scheduledRegions?.length ? (
                <p className="mt-1 text-xs text-[#9cdcfe]">
                  定时区域 {overview.worker.scheduledRegions.join(" · ")} · 队列{" "}
                  {overview.worker.queueName ?? "crawl"}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-[#858585]">
                GET {adminCrawlOverviewUrl().replace(/^https?:\/\/[^/]+/, "")}
              </p>
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-12">
          <section className="flex flex-col gap-4 lg:col-span-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#858585]">
              引擎开关
            </h2>
            <EngineSwitch
              id="sw-live"
              label="遥测中继"
              hint="开启后与后端建立轮询链路；关闭后静止（节省请求）。"
              checked={liveRelay}
              onChange={setLiveRelay}
              accent="cyan"
            />
            <EngineSwitch
              id="sw-hyper"
              label="超同步"
              hint="更高刷新频率，适合抓取演示或排障。"
              checked={hyperSync}
              onChange={setHyperSync}
              accent="fuchsia"
            />
            <EngineSwitch
              id="sw-hud"
              label="光谱 HUD"
              hint="增强扫描线与光晕层（仅视觉，不影响数据）。"
              checked={spectralHud}
              onChange={setSpectralHud}
              accent="cyan"
            />
            <EngineSwitch
              id="sw-raster"
              label="辅栅格场"
              hint="背景粒子与漂移网格密度（仅视觉）。"
              checked={auxRaster}
              onChange={setAuxRaster}
              accent="amber"
            />

            <div className="rounded-xl border border-white/10 bg-black/35 p-4 backdrop-blur-sm">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-[#9d9d9d]">
                任务入轨
              </h3>
              <p className="mt-1 text-xs text-[#9d9d9d]">
                POST{" "}
                <code className="text-[#9cdcfe]">/v1/crawl/tasks</code>
              </p>
              <div className="mt-3 space-y-2">
                <div>
                  <Label className="text-[#b4b4b4]">sourceId</Label>
                  <Input
                    value={dispatchSourceId}
                    onChange={(e) => setDispatchSourceId(e.target.value)}
                    className="mt-1 border-white/15 bg-black/50 font-mono text-[#9cdcfe]"
                    placeholder="从下方列表复制"
                  />
                </div>
                <div>
                  <Label className="text-[#b4b4b4]">seedUrl</Label>
                  <Input
                    value={dispatchSeed}
                    maxLength={HTTP_URL_INPUT_MAX_LEN}
                    onChange={(e) => setDispatchSeed(e.target.value)}
                    className="mt-1 border-white/15 bg-black/50 text-[#9cdcfe]"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[#b4b4b4]">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-white/30 accent-fuchsia-500"
                    checked={dispatchAsync}
                    onChange={(e) => setDispatchAsync(e.target.checked)}
                  />
                  async（BullMQ 异步队列）
                </label>
                <Button
                  type="button"
                  disabled={dispatchBusy}
                  onClick={() => void fireTask()}
                  className="w-full bg-gradient-to-r from-cyan-600 to-fuchsia-600 font-semibold text-[#f0f0f0] hover:from-cyan-500 hover:to-fuchsia-500"
                >
                  {dispatchBusy ? "发射中…" : "⚡ 发射爬取任务"}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/35 p-4">
              <Label className="text-[#b4b4b4]">追踪 taskId（可选）</Label>
              <Input
                value={taskWatchId}
                onChange={(e) => setTaskWatchId(e.target.value)}
                className="mt-1 border-white/15 bg-black/50 font-mono text-sm text-[#c586c0]"
                placeholder="十进制任务 id"
              />
              {taskView ? (
                <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/60 p-2 text-xs text-[#c586c0]">
                  {JSON.stringify(taskView, null, 2)}
                </pre>
              ) : (
                <p className="mt-2 text-xs text-[#858585]">
                  入轨成功后自动写入；亦可手填。
                </p>
              )}
            </div>
          </section>

          <section className="lg:col-span-5">
            <div className="flex flex-col items-center gap-6">
              <div
                className={cn(
                  "relative flex aspect-square w-full max-w-[280px] items-center justify-center",
                  liveRelay && "animate-[crawl-core-pulse_3.2s_ease-in-out_infinite]",
                )}
              >
                <div
                  className="absolute inset-[10%] rounded-full border border-cyan-400/25"
                  style={{
                    animation: "crawl-ring-spin 18s linear infinite",
                  }}
                />
                <div
                  className="absolute inset-[22%] rounded-full border border-fuchsia-400/35"
                  style={{
                    animation: "crawl-ring-spin 12s linear reverse infinite",
                  }}
                />
                <div className="relative flex h-[44%] w-[44%] items-center justify-center rounded-full border-2 border-cyan-300/40 bg-gradient-to-br from-cyan-500/30 via-black/60 to-fuchsia-600/25 shadow-[inset_0_0_40px_oklch(0.6_0.2_280_/_0.25)]">
                  <div className="text-center">
                    <p className="text-xs uppercase tracking-[0.25em] text-[#9d9d9d]">
                      Core
                    </p>
                    <p className="mt-1 font-mono text-[22px] font-bold tabular-nums text-[#9cdcfe]">
                      {sources.length}
                    </p>
                    <p className="text-xs text-[#9d9d9d]">SOURCES</p>
                  </div>
                </div>
                {auxRaster
                  ? [0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="pointer-events-none absolute rounded-full border border-cyan-400/12"
                        style={{
                          width: `${58 + i * 11}%`,
                          height: `${58 + i * 11}%`,
                          left: "50%",
                          top: "50%",
                          transform: "translate(-50%, -50%)",
                          animation: `crawl-float-particle ${4.8 + i * 0.75}s ease-in-out infinite`,
                          animationDelay: `${i * 0.4}s`,
                        }}
                      />
                    ))
                  : null}
              </div>

              <div className="w-full space-y-3 rounded-xl border border-white/10 bg-black/40 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9d9d9d]">
                  数据信道
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Label className="sr-only">当前 source</Label>
                  <select
                    value={selectedSourceId || resolvedSourceId.current}
                    onChange={(e) => { setSelectedSourceId(e.target.value); setUrlRows([]); setRecentTasks([]); seenUrlIds.current = new Set(); }}
                    className="min-w-[12rem] flex-1 rounded-md border border-white/15 bg-black/55 px-3 py-2 text-sm text-[#9cdcfe]"
                  >
                    {sources.length === 0 ? (
                      <option value="">（无源）</option>
                    ) : (
                      sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          #{s.id} · {s.name || s.kind}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                {overviewError || sourcesError ? <p role="status" className="text-xs text-[#dcdcaa]">
                  {overviewError ? "全局概要暂时无法更新。" : ""}{sourcesError ? "信源列表暂时无法更新。" : ""}
                </p> : null}
                {apiError ? (
                  <p className="text-xs text-[#dcdcaa]">{apiError}</p>
                ) : null}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/10 bg-white/5 py-2">
                    <p className="text-xs uppercase text-[#9d9d9d]">样本</p>
                    <p className="font-mono text-lg text-[#9cdcfe]">
                      {metrics.total}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 py-2">
                    <p className="text-xs uppercase text-[#9d9d9d]">
                      fetched
                    </p>
                    <p className="font-mono text-lg text-emerald-300">
                      {metrics.fetched}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 py-2">
                    <p className="text-xs uppercase text-[#9d9d9d]">reg</p>
                    <p className="font-mono text-lg text-amber-200">
                      {metrics.reg}
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#858585]">
                      最近 CrawlTask
                    </h4>
                    <span className="text-xs text-[#858585]">
                      点击行填入左侧追踪 · current source
                    </span>
                  </div>
                  <div className="max-h-36 overflow-auto rounded-lg border border-fuchsia-500/20 bg-black/50">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-black/90 text-[#9d9d9d]">
                        <tr>
                          <th className="px-2 py-1.5">id</th>
                          <th className="px-2 py-1.5">状态</th>
                          <th className="px-2 py-1.5">更新</th>
                        </tr>
                      </thead>
                      <tbody className="text-[#cccccc]">
                        {recentTasks.map((t) => (
                          <tr
                            key={t.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setTaskWatchId(t.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setTaskWatchId(t.id);
                              }
                            }}
                            className="cursor-pointer border-t border-white/5 hover:bg-fuchsia-500/15"
                          >
                            <td className="px-2 py-1 font-mono text-[#c586c0]">
                              {t.id}
                            </td>
                            <td className="px-2 py-1 text-[#9cdcfe]">{t.status}</td>
                            <td
                              className="max-w-[7rem] truncate px-2 py-1 text-[#9d9d9d]"
                              title={t.updatedAt ?? t.createdAt}
                            >
                              {t.updatedAt || t.createdAt
                                ? formatShortTaskTime(
                                    (t.updatedAt ?? t.createdAt) as string,
                                  )
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {recentTasks.length === 0 ? (
                      <p className="p-3 text-center text-xs text-[#858585]">
                        暂无任务
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="max-h-52 overflow-auto rounded-lg border border-white/10 bg-black/55">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-black/90 text-[#9d9d9d]">
                      <tr>
                        <th className="px-2 py-1.5">id</th>
                        <th className="px-2 py-1.5">状态</th>
                        <th className="px-2 py-1.5">title / dom</th>
                        <th className="px-2 py-1.5">url</th>
                      </tr>
                    </thead>
                    <tbody className="text-[#cccccc]">
                      {urlRows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-t border-white/5 hover:bg-white/[0.04]"
                        >
                          <td className="px-2 py-1 font-mono text-[#9cdcfe]">
                            {r.id}
                          </td>
                          <td className="px-2 py-1 text-[#c586c0]">
                            {r.status ?? "—"}
                          </td>
                          <td
                            className="max-w-[140px] truncate px-2 py-1 text-[#b4b4b4]"
                            title={r.pageTitle ?? r.domHint ?? undefined}
                          >
                            {r.pageTitle ?? r.domHint ?? "—"}
                          </td>
                          <td className="max-w-[200px] truncate px-2 py-1" title={r.url}>
                            {r.url}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {urlRows.length === 0 ? (
                    <p className="p-4 text-center text-[#858585]">暂无 URL 样本</p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="lg:col-span-3">
            <div className="flex h-full min-h-[28rem] flex-col rounded-xl border border-white/10 bg-black/40">
              <div className="border-b border-white/10 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9d9d9d]">
                  事件流
                </h3>
                <p className="text-xs text-[#858585]">
                  最新在上 · 仅展示真实遥测 diff 与操作
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
                {log.map((line) => (
                  <div
                    key={line.id}
                    className="border-b border-white/5 py-1.5 last:border-0"
                  >
                    <span className="text-[#858585]">{formatClock(line.t)} </span>
                    <span className={logColor(line.kind)}>{line.msg}</span>
                  </div>
                ))}
                {log.length === 0 ? (
                  <p className="py-8 text-center text-[#858585]">等待中继…</p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
