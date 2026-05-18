"use client";

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
import { isDecimalBigIntIdString } from "@/lib/decimal-id";
import {
  nestCrawlSourcesListUrl,
  nestCrawlSourceUrlsUrl,
  nestCrawlTasksListUrl,
  nestCrawlTaskUrl,
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
const POLL_HYPER_MS = 850;
const POLL_CALM_MS = 2600;

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
        <span className="block text-sm font-semibold tracking-wide text-white/95">
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-white/55">
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

  const [taskWatchId, setTaskWatchId] = useState("");
  const [taskView, setTaskView] = useState<CrawlTaskRow | null>(null);

  const [dispatchSourceId, setDispatchSourceId] = useState("");
  const [dispatchSeed, setDispatchSeed] = useState("https://example.com/");
  const [dispatchAsync, setDispatchAsync] = useState(true);
  const [dispatchBusy, setDispatchBusy] = useState(false);

  const [log, setLog] = useState<LogLine[]>([]);
  const logBoot = useRef(false);
  const seenUrlIds = useRef<Set<string>>(new Set());
  const prevTaskStatus = useRef<string | null>(null);
  const idleStreak = useRef(0);
  const noSourcePing = useRef(false);
  const taskListStatusRef = useRef<Map<string, string>>(new Map());

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

  const pollMs = hyperSync ? POLL_HYPER_MS : POLL_CALM_MS;

  useEffect(() => {
    if (sources.length === 0) return;
    setSelectedSourceId((prev) => {
      if (prev && sources.some((s) => s.id === prev)) return prev;
      return sources[0].id;
    });
  }, [sources]);

  const pulseTick = useCallback(async () => {
    if (!liveRelay) return;
    setApiError(null);
    try {
      const sRes = await fetch(
        nestCrawlSourcesListUrl(CRAWL_SOURCES_LIST_LIMIT_DEFAULT),
        { cache: "no-store" },
      );
      const sText = await sRes.text();
      if (!sRes.ok) {
        setApiError(`sources HTTP ${sRes.status}`);
        pushLog(`遥测异常 · sources ${sRes.status}`, "warn");
        return;
      }
      const nextSources = parseSourcesJson(sText);
      setSources(nextSources);

      let sid = selectedSourceId.trim();
      if (!sid && nextSources[0]) sid = nextSources[0].id;
      if (
        sid &&
        nextSources.length > 0 &&
        !nextSources.some((x) => x.id === sid)
      ) {
        sid = nextSources[0].id;
        setSelectedSourceId(sid);
      }

      if (!sid) {
        setUrlRows([]);
        setRecentTasks([]);
        setLastApiPulse(Date.now());
        if (!noSourcePing.current) {
          noSourcePing.current = true;
          pushLog("遥测在线 · 当前无数据源（可在经典爬虫页登记 source）", "warn");
        }
        return;
      }
      noSourcePing.current = false;

      const uRes = await fetch(
        nestCrawlSourceUrlsUrl(sid, CRAWL_SOURCE_URLS_PREVIEW_LIMIT),
        { cache: "no-store" },
      );
      const uText = await uRes.text();
      if (!uRes.ok) {
        setApiError(`urls HTTP ${uRes.status}`);
        pushLog(`遥测异常 · urls ${uRes.status}`, "warn");
        return;
      }
      const rows = parseUrlsJson(uText);
      setUrlRows(rows);

      if (!logBoot.current) {
        logBoot.current = true;
        rows.forEach((r) => seenUrlIds.current.add(r.id));
        pushLog(
          `中继在线 · 同步 ${nextSources.length} 源 · 信道 ${sid}`,
          "pulse",
        );
      } else {
        let novel = 0;
        for (const r of rows) {
          if (!seenUrlIds.current.has(r.id)) {
            seenUrlIds.current.add(r.id);
            novel++;
            pushLog(
              `INGEST 新 URL #${r.id} · ${r.status ?? "?"} · ${r.url.slice(0, 72)}${r.url.length > 72 ? "…" : ""}`,
              "ingest",
            );
          }
        }
        if (novel === 0) {
          idleStreak.current += 1;
          if (idleStreak.current % 5 === 0) {
            pushLog(
              `φ 信道稳态 · ${rows.length} 条样本 · ${formatClock(Date.now())}`,
              "pulse",
            );
          }
        } else {
          idleStreak.current = 0;
        }
      }

      const taskListUrl = nestCrawlTasksListUrl(12, sid);
      const taskRes = await fetch(taskListUrl, { cache: "no-store" });
      if (taskRes.ok) {
        const tasks = parseTasksListJson(await taskRes.text());
        setRecentTasks(tasks);
        const allowTaskDiff = logBoot.current;
        for (const t of tasks) {
          const prev = taskListStatusRef.current.get(t.id);
          if (
            allowTaskDiff &&
            prev !== undefined &&
            prev !== t.status
          ) {
            pushLog(`TASK #${t.id} 状态 ${prev}→${t.status}`, "task");
          }
          taskListStatusRef.current.set(t.id, t.status);
        }
        const keep = new Set(tasks.map((x) => x.id));
        for (const k of taskListStatusRef.current.keys()) {
          if (!keep.has(k)) taskListStatusRef.current.delete(k);
        }
      } else {
        setRecentTasks([]);
      }

      setLastApiPulse(Date.now());
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setApiError(m);
      pushLog(`链路抖动 · ${m}`, "warn");
    }
  }, [liveRelay, pushLog, selectedSourceId]);

  useEffect(() => {
    if (!liveRelay) return;
    void pulseTick();
    const id = window.setInterval(() => void pulseTick(), pollMs);
    return () => clearInterval(id);
  }, [liveRelay, pollMs, pulseTick]);

  useEffect(() => {
    const id = taskWatchId.trim();
    if (!liveRelay || !id || !isDecimalBigIntIdString(id)) {
      setTaskView(null);
      prevTaskStatus.current = null;
      return;
    }
    let cancelled = false;
    const pollTask = async () => {
      try {
        const res = await fetch(nestCrawlTaskUrl(id), { cache: "no-store" });
        const text = await res.text();
        if (cancelled) return;
        if (!res.ok) {
          pushLog(`TASK 查询失败 ${res.status}`, "warn");
          return;
        }
        const t = parseTaskJson(text);
        setTaskView(t);
        if (t && t.status !== prevTaskStatus.current) {
          if (prevTaskStatus.current != null) {
            pushLog(`TASK #${t.id.slice(-8)} 状态迁移 → ${t.status}`, "task");
          }
          prevTaskStatus.current = t.status;
        }
      } catch {
        if (!cancelled) pushLog("TASK 查询异常", "warn");
      }
    };
    void pollTask();
    const handle = window.setInterval(() => void pollTask(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [liveRelay, taskWatchId, pollMs, pushLog]);

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
        headers: { "Content-Type": "application/json" },
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
        return "text-cyan-300/95";
      case "task":
        return "text-fuchsia-300/95";
      case "warn":
        return "text-amber-300/95";
      case "ops":
        return "text-emerald-300/95";
      default:
        return "text-sky-200/80";
    }
  };

  return (
    <div
      className={cn(
        "crawl-monitor-deck relative overflow-hidden rounded-2xl border border-cyan-500/25 bg-[#030711] text-sm shadow-[0_0_60px_oklch(0.55_0.2_260_/_0.08)]",
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
            <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-cyan-400/90">
              Crawl Nexus · Live
            </p>
            <h1 className="mt-2 bg-gradient-to-r from-cyan-200 via-white to-fuchsia-300 bg-clip-text text-2xl font-bold tracking-tight text-transparent md:text-3xl">
              爬虫引擎监控甲板
            </h1>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-white/55">
              实时汇聚{" "}
              <code className="rounded bg-white/10 px-1 text-xs text-cyan-200/90">
                GET /v1/crawl/sources
              </code>{" "}
              与{" "}
              <code className="rounded bg-white/10 px-1 text-xs text-cyan-200/90">
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
              className="shrink-0 border-cyan-400/45 bg-black/45 text-cyan-100 shadow-[0_0_16px_oklch(0.65_0.15_195_/_0.25)] hover:bg-cyan-500/15"
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
                "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider",
                liveRelay
                  ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                  : "border-white/20 bg-black/40 text-white/45",
              )}
            >
              {liveRelay ? "遥测中继 · ON" : "遥测中继 · STANDBY"}
            </span>
            <span className="rounded-full border border-white/15 bg-black/35 px-3 py-1 text-[11px] text-white/60">
              Δt {pollMs}ms
            </span>
            {lastApiPulse ? (
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-100/90">
                最后脉冲 {formatClock(lastApiPulse)}
              </span>
            ) : null}
            <Link
              href={ADMIN_HREF.crawl}
              className="rounded-full border border-fuchsia-500/35 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-medium text-fuchsia-100/90 underline-offset-4 hover:underline"
            >
              经典爬虫表单 →
            </Link>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-12">
          <section className="flex flex-col gap-4 lg:col-span-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
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
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-white/45">
                任务入轨
              </h3>
              <p className="mt-1 text-[11px] text-white/45">
                POST{" "}
                <code className="text-cyan-200/80">/v1/crawl/tasks</code>
              </p>
              <div className="mt-3 space-y-2">
                <div>
                  <Label className="text-white/60">sourceId</Label>
                  <Input
                    value={dispatchSourceId}
                    onChange={(e) => setDispatchSourceId(e.target.value)}
                    className="mt-1 border-white/15 bg-black/50 font-mono text-cyan-100"
                    placeholder="从下方列表复制"
                  />
                </div>
                <div>
                  <Label className="text-white/60">seedUrl</Label>
                  <Input
                    value={dispatchSeed}
                    maxLength={HTTP_URL_INPUT_MAX_LEN}
                    onChange={(e) => setDispatchSeed(e.target.value)}
                    className="mt-1 border-white/15 bg-black/50 text-cyan-100"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60">
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
                  className="w-full bg-gradient-to-r from-cyan-600 to-fuchsia-600 font-semibold text-white hover:from-cyan-500 hover:to-fuchsia-500"
                >
                  {dispatchBusy ? "发射中…" : "⚡ 发射爬取任务"}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/35 p-4">
              <Label className="text-white/60">追踪 taskId（可选）</Label>
              <Input
                value={taskWatchId}
                onChange={(e) => setTaskWatchId(e.target.value)}
                className="mt-1 border-white/15 bg-black/50 font-mono text-sm text-fuchsia-100"
                placeholder="十进制任务 id"
              />
              {taskView ? (
                <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/60 p-2 text-[11px] text-fuchsia-100/90">
                  {JSON.stringify(taskView, null, 2)}
                </pre>
              ) : (
                <p className="mt-2 text-[11px] text-white/40">
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
                    <p className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                      Core
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-cyan-100">
                      {sources.length}
                    </p>
                    <p className="text-[10px] text-white/45">SOURCES</p>
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
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                  数据信道
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Label className="sr-only">当前 source</Label>
                  <select
                    value={selectedSourceId}
                    onChange={(e) => setSelectedSourceId(e.target.value)}
                    className="min-w-[12rem] flex-1 rounded-md border border-white/15 bg-black/55 px-3 py-2 text-sm text-cyan-100"
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
                {apiError ? (
                  <p className="text-xs text-amber-300">{apiError}</p>
                ) : null}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/10 bg-white/5 py-2">
                    <p className="text-[10px] uppercase text-white/45">样本</p>
                    <p className="font-mono text-lg text-cyan-200">
                      {metrics.total}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 py-2">
                    <p className="text-[10px] uppercase text-white/45">
                      fetched
                    </p>
                    <p className="font-mono text-lg text-emerald-300">
                      {metrics.fetched}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 py-2">
                    <p className="text-[10px] uppercase text-white/45">reg</p>
                    <p className="font-mono text-lg text-amber-200">
                      {metrics.reg}
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      最近 CrawlTask
                    </h4>
                    <span className="text-[10px] text-white/35">
                      点击行填入左侧追踪 · current source
                    </span>
                  </div>
                  <div className="max-h-36 overflow-auto rounded-lg border border-fuchsia-500/20 bg-black/50">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-black/90 text-white/45">
                        <tr>
                          <th className="px-2 py-1.5">id</th>
                          <th className="px-2 py-1.5">状态</th>
                          <th className="px-2 py-1.5">更新</th>
                        </tr>
                      </thead>
                      <tbody className="text-white/70">
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
                            <td className="px-2 py-1 font-mono text-fuchsia-200/90">
                              {t.id}
                            </td>
                            <td className="px-2 py-1 text-cyan-200/90">{t.status}</td>
                            <td
                              className="max-w-[7rem] truncate px-2 py-1 text-white/50"
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
                      <p className="p-3 text-center text-[11px] text-white/35">
                        暂无任务
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="max-h-52 overflow-auto rounded-lg border border-white/10 bg-black/55">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 bg-black/90 text-white/45">
                      <tr>
                        <th className="px-2 py-1.5">id</th>
                        <th className="px-2 py-1.5">状态</th>
                        <th className="px-2 py-1.5">url</th>
                      </tr>
                    </thead>
                    <tbody className="text-white/70">
                      {urlRows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-t border-white/5 hover:bg-white/[0.04]"
                        >
                          <td className="px-2 py-1 font-mono text-cyan-200/90">
                            {r.id}
                          </td>
                          <td className="px-2 py-1 text-fuchsia-200/90">
                            {r.status ?? "—"}
                          </td>
                          <td className="max-w-[200px] truncate px-2 py-1" title={r.url}>
                            {r.url}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {urlRows.length === 0 ? (
                    <p className="p-4 text-center text-white/40">暂无 URL 样本</p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="lg:col-span-3">
            <div className="flex h-full min-h-[28rem] flex-col rounded-xl border border-white/10 bg-black/40">
              <div className="border-b border-white/10 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                  事件流
                </h3>
                <p className="text-[10px] text-white/35">
                  最新在上 · 仅展示真实遥测 diff 与操作
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
                {log.map((line) => (
                  <div
                    key={line.id}
                    className="border-b border-white/5 py-1.5 last:border-0"
                  >
                    <span className="text-white/35">{formatClock(line.t)} </span>
                    <span className={logColor(line.kind)}>{line.msg}</span>
                  </div>
                ))}
                {log.length === 0 ? (
                  <p className="py-8 text-center text-white/35">等待中继…</p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
