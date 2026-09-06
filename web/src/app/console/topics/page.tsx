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
import { briefCell } from "@/lib/snapshot-ai-brief-stats";
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
  nestTopicSnapshotsUrl,
  nestTopicTrendAnalysesUrl,
  nestTopicUrl,
  nestTopicVersionsUrl,
  nestTopicVersionPolicyUrl,
  nestSnapshotScoreBreakdownsUrl,
} from "@/lib/nest-api-urls";
import {
  TOPIC_KIND_OPTIONS,
  type TopicKindValue,
  isTopicKindValue,
} from "@/lib/topic-kind";
import { unifiedSearchAdminPathFromQuery } from "@/lib/unified-search-admin-path";
import { isIsoDateString } from "@/lib/iso-date";
import { TIME_WINDOW_SET } from "@/lib/time-window";
import { useRankingRealtimeSse } from "@/hooks/use-ranking-realtime-sse";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

const POLICY_METRIC_KEYS = ["streams", "mentions", "social", "news"] as const;
type PolicyMetricKey = (typeof POLICY_METRIC_KEYS)[number];

type QuickWeightsState = Record<PolicyMetricKey, string>;

const EMPTY_QUICK_WEIGHTS: QuickWeightsState = {
  streams: "",
  mentions: "",
  social: "",
  news: "",
};

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

type KindStrategy = {
  kind: string;
  description: string;
  weights: Record<string, number>;
  requiredSignalKeys: string[];
  minCoverageToRank: number;
  decay?: { halfLifeDays?: number };
};

type TopicMeta = {
  id: string;
  slug: string;
  title: string;
  kind: TopicKindValue;
  locale: string;
  kindStrategy?: KindStrategy;
};

function parseKindStrategy(raw: unknown): KindStrategy | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.description !== "string") return undefined;
  const weights =
    o.weights && typeof o.weights === "object" && !Array.isArray(o.weights)
      ? (o.weights as Record<string, number>)
      : {};
  const requiredSignalKeys = Array.isArray(o.requiredSignalKeys)
    ? o.requiredSignalKeys.map(String)
    : [];
  return {
    kind: String(o.kind ?? ""),
    description: o.description,
    weights,
    requiredSignalKeys,
    minCoverageToRank: Number(o.minCoverageToRank) || 0,
    decay:
      o.decay && typeof o.decay === "object"
        ? (o.decay as { halfLifeDays?: number })
        : undefined,
  };
}

function parseTopicMetaFromJson(
  j: Record<string, unknown>,
  slugFallback: string,
): TopicMeta {
  const kindRaw = j.kind != null ? String(j.kind) : "";
  const kind: TopicKindValue = isTopicKindValue(kindRaw)
    ? kindRaw
    : "SEMI_OBJECTIVE";
  return {
    id: String(j.id ?? ""),
    slug: String(j.slug ?? slugFallback),
    title: String(j.title ?? ""),
    kind,
    locale: String(j.locale ?? ""),
    kindStrategy: parseKindStrategy(j.kindStrategy),
  };
}

type TopicVersionRow = {
  id: string;
  version: string;
  effectiveFrom?: string;
  frozen: boolean;
  policyJson: unknown;
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
    hasScoreModel?: boolean;
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
        frozen: o.frozen === true,
        policyJson: o.policyJson,
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
      hasScoreModel:
        r.hasScoreModel === true
          ? true
          : r.hasScoreModel === false
            ? false
            : undefined,
    },
    items,
  };
}

function clampQueryParam(raw: string, maxLen: number): string {
  const t = raw.trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

type TrendAnalysisListItem = {
  id: string;
  window: string;
  createdAt: string;
  payload: unknown;
};

type TopicSnapshotListItem = {
  id: string;
  snapshotTime: string;
  snapshotVersion: string;
  confidenceScore: number;
  generatedByAi: boolean;
  topicRankingId: string;
  /** `GET /v1/topics/:slug/snapshots`：该快照下 AiAnalysis 条数 */
  aiAnalysisCount?: number;
  /** 是否存在物化跟进类简报（agent 或 detailJson.agentKind） */
  hasFollowupBrief?: boolean;
  /** trend-v1 / agentKind=trend */
  hasTrendBrief?: boolean;
  /** credibility-v1 / agentKind=credibility */
  hasCredibilityBrief?: boolean;
  hasFactCheckBrief?: boolean;
  hasTrendAnalysisBrief?: boolean;
  hasTimeSeriesBrief?: boolean;
  hasRankingBrief?: boolean;
  hasScoreModel?: boolean;
  topicRanking: {
    id: string;
    timeWindow: string;
    windowStart: string;
    windowEnd: string;
    status: string;
    topicVersionId: string;
    topicVersionLabel: string;
  };
};

function parseTrendPayloadPreview(payload: unknown): {
  snapshotId?: string;
  itemCount?: number;
  avgConfidence?: number;
  topGainerNames: string[];
} {
  const base = { topGainerNames: [] as string[] };
  if (typeof payload !== "object" || payload === null) return base;
  const o = payload as Record<string, unknown>;
  const snapshotId = o.snapshotId != null ? String(o.snapshotId) : undefined;
  const itemCount = typeof o.itemCount === "number" ? o.itemCount : undefined;
  const avgConfidence =
    typeof o.avgConfidence === "number" ? o.avgConfidence : undefined;
  const gainers = o.topRankGainers;
  const names: string[] = [];
  if (Array.isArray(gainers)) {
    for (const g of gainers.slice(0, 3)) {
      if (typeof g === "object" && g !== null) {
        const gn = (g as Record<string, unknown>).canonicalName;
        if (gn != null) names.push(String(gn));
      }
    }
  }
  return {
    snapshotId,
    itemCount,
    avgConfidence,
    topGainerNames: names,
  };
}

function TopicsPageInner() {
  const { abs } = useAdminAppUrl();
  const searchParams = useSearchParams();
  const [slug, setSlug] = useState("global-female-singers");
  const [topicMeta, setTopicMeta] = useState<TopicMeta | null>(null);
  const [topicKindDraft, setTopicKindDraft] =
    useState<TopicKindValue>("SEMI_OBJECTIVE");
  const [topicTitleDraft, setTopicTitleDraft] = useState("");
  const [topicSaving, setTopicSaving] = useState(false);
  const [topicMsg, setTopicMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [versionRows, setVersionRows] = useState<TopicVersionRow[]>([]);
  const [policyTargetId, setPolicyTargetId] = useState<string | null>(null);
  const [policyDraft, setPolicyDraft] = useState("");
  const [policyMsg, setPolicyMsg] = useState("");
  const [policySaving, setPolicySaving] = useState(false);
  const [quickWeights, setQuickWeights] =
    useState<QuickWeightsState>(EMPTY_QUICK_WEIGHTS);
  const [quickEntityIds, setQuickEntityIds] = useState("");
  const [quickRequired, setQuickRequired] = useState<string[]>([]);

  const applyJsonTextToQuickForm = useCallback((text: string) => {
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      const wraw = o.weights;
      const w =
        wraw && typeof wraw === "object" && !Array.isArray(wraw)
          ? (wraw as Record<string, unknown>)
          : {};
      setQuickWeights({
        streams: w.streams != null ? String(w.streams) : "",
        mentions: w.mentions != null ? String(w.mentions) : "",
        social: w.social != null ? String(w.social) : "",
        news: w.news != null ? String(w.news) : "",
      });
      const ids = o.entityIds;
      if (Array.isArray(ids)) {
        setQuickEntityIds(
          ids.map((x) => String(x).trim()).filter(Boolean).join(", "),
        );
      } else {
        setQuickEntityIds("");
      }
      const req = o.requiredSignalKeys;
      if (Array.isArray(req)) {
        setQuickRequired(req.map((x) => String(x)));
      } else {
        setQuickRequired([]);
      }
    } catch {
      setQuickWeights(EMPTY_QUICK_WEIGHTS);
      setQuickEntityIds("");
      setQuickRequired([]);
    }
  }, []);

  function mergeQuickFormIntoPolicyDraft() {
    let base: Record<string, unknown>;
    try {
      const parsed = JSON.parse(policyDraft) as unknown;
      base =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      base = {};
    }
    const prevWeights =
      base.weights &&
      typeof base.weights === "object" &&
      !Array.isArray(base.weights)
        ? { ...(base.weights as Record<string, unknown>) }
        : {};
    for (const k of POLICY_METRIC_KEYS) {
      const raw = quickWeights[k].trim();
      if (raw === "") {
        delete prevWeights[k];
      } else {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) prevWeights[k] = n;
      }
    }
    base.weights = prevWeights;

    const idsPart = quickEntityIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (idsPart.length > 0) {
      base.entityIds = idsPart;
    } else {
      delete base.entityIds;
    }

    if (quickRequired.length > 0) {
      base.requiredSignalKeys = [...quickRequired];
    } else {
      delete base.requiredSignalKeys;
    }

    setPolicyDraft(JSON.stringify(base, null, 2));
  }

  useEffect(() => {
    if (!policyTargetId) {
      setPolicyDraft("");
      setQuickWeights(EMPTY_QUICK_WEIGHTS);
      setQuickEntityIds("");
      setQuickRequired([]);
      return;
    }
    const row = versionRows.find((r) => r.id === policyTargetId);
    if (!row) return;
    try {
      const text = JSON.stringify(row.policyJson ?? {}, null, 2);
      setPolicyDraft(text);
      applyJsonTextToQuickForm(text);
    } catch {
      setPolicyDraft("");
      setQuickWeights(EMPTY_QUICK_WEIGHTS);
      setQuickEntityIds("");
      setQuickRequired([]);
    }
  }, [policyTargetId, versionRows, applyJsonTextToQuickForm]);

  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardResult, setLeaderboardResult] = useState<string>("");
  const [leaderboardPreview, setLeaderboardPreview] =
    useState<LeaderboardPreview | null>(null);
  const [lbQueryVersion, setLbQueryVersion] = useState("");
  const [lbQueryTimeWindow, setLbQueryTimeWindow] = useState("");
  const [lbQueryWindowStart, setLbQueryWindowStart] = useState("");
  const [lbIncludeAiStats, setLbIncludeAiStats] = useState(false);
  const [lbRealtimeSse, setLbRealtimeSse] = useState(true);
  const [listsRefreshNonce, setListsRefreshNonce] = useState(0);

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
    if (lbIncludeAiStats) q.set("includeAiStats", "1");
    return nestTopicLeaderboardUrl(slugForApi, q);
  }, [slugForApi, lbQueryVersion, lbQueryTimeWindow, lbQueryWindowStart, lbIncludeAiStats]);

  const trendAnalysesApiUrl = useMemo(
    () =>
      nestTopicTrendAnalysesUrl(
        slugForApi,
        new URLSearchParams([["limit", "20"]]),
      ),
    [slugForApi],
  );

  const topicSnapshotsApiUrl = useMemo(
    () =>
      nestTopicSnapshotsUrl(
        slugForApi,
        new URLSearchParams([["limit", "25"]]),
      ),
    [slugForApi],
  );

  const [trendRows, setTrendRows] = useState<TrendAnalysisListItem[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTrendLoading(true);
      setTrendRows([]);
      try {
        const res = await fetch(trendAnalysesApiUrl, { cache: "no-store" });
        const text = await res.text();
        if (cancelled) return;
        if (!res.ok) return;
        try {
          const j = JSON.parse(text) as { analyses?: TrendAnalysisListItem[] };
          setTrendRows(Array.isArray(j.analyses) ? j.analyses : []);
        } catch {
          setTrendRows([]);
        }
      } catch {
        if (!cancelled) setTrendRows([]);
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trendAnalysesApiUrl, listsRefreshNonce]);

  const [snapshotRows, setSnapshotRows] = useState<TopicSnapshotListItem[]>(
    [],
  );
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSnapshotLoading(true);
      setSnapshotRows([]);
      try {
        const res = await fetch(topicSnapshotsApiUrl, { cache: "no-store" });
        const text = await res.text();
        if (cancelled) return;
        if (!res.ok) return;
        try {
          const j = JSON.parse(text) as {
            snapshots?: TopicSnapshotListItem[];
          };
          setSnapshotRows(
            Array.isArray(j.snapshots) ? j.snapshots : [],
          );
        } catch {
          setSnapshotRows([]);
        }
      } catch {
        if (!cancelled) setSnapshotRows([]);
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topicSnapshotsApiUrl, listsRefreshNonce]);

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
    const ias = searchParams.get("includeAiStats");
    setLbIncludeAiStats(
      ias === "1" || (typeof ias === "string" && ias.toLowerCase() === "true"),
    );
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
      if (lbIncludeAiStats) q.set("includeAiStats", "1");
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

  const loadLeaderboardRef = useRef(loadLeaderboard);
  loadLeaderboardRef.current = loadLeaderboard;

  const { connectionState: lbSseState } = useRankingRealtimeSse({
    topics: lbRealtimeSse ? [slugForApi] : [],
    enabled: lbRealtimeSse && Boolean(slugForApi),
    onSnapshotReady: () => {
      void loadLeaderboardRef.current?.();
      setListsRefreshNonce((n) => n + 1);
    },
  });

  async function loadTopicMeta() {
    setTopicMsg("");
    try {
      const res = await fetch(nestTopicUrl(slugForApi), { cache: "no-store" });
      const text = await res.text();
      if (!res.ok) {
        setTopicMeta(null);
        setTopicMsg(`话题 ${res.status}: ${text.slice(0, 400)}`);
        return;
      }
      const j = JSON.parse(text) as Record<string, unknown>;
      const meta = parseTopicMetaFromJson(j, slugForApi);
      setTopicMeta(meta);
      setTopicKindDraft(meta.kind);
      setTopicTitleDraft(meta.title);
    } catch (e) {
      setTopicMeta(null);
      setTopicMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveTopicMeta() {
    setTopicSaving(true);
    setTopicMsg("");
    try {
      const body: { kind: TopicKindValue; title?: string } = {
        kind: topicKindDraft,
      };
      const title = topicTitleDraft.trim();
      if (title) body.title = title;
      const res = await fetch(nestTopicUrl(slugForApi), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        setTopicMsg(`${res.status} ${text.slice(0, 2000)}`);
        return;
      }
      setTopicMsg("已保存 TopicKind / 标题");
      await loadTopicMeta();
    } catch (e) {
      setTopicMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTopicSaving(false);
    }
  }

  async function load() {
    setLoading(true);
    setResult("");
    setVersionRows([]);
    try {
      const [topicRes, versionsRes] = await Promise.all([
        fetch(nestTopicUrl(slugForApi), { cache: "no-store" }),
        fetch(nestTopicVersionsUrl(slugForApi), { cache: "no-store" }),
      ]);
      const topicText = await topicRes.text();
      if (topicRes.ok) {
        try {
          const j = JSON.parse(topicText) as Record<string, unknown>;
          const meta = parseTopicMetaFromJson(j, slugForApi);
          setTopicMeta(meta);
          setTopicKindDraft(meta.kind);
          setTopicTitleDraft(meta.title);
          setTopicMsg("");
        } catch {
          setTopicMeta(null);
        }
      } else {
        setTopicMeta(null);
        setTopicMsg(`话题 ${topicRes.status}: ${topicText.slice(0, 400)}`);
      }

      const text = await versionsRes.text();
      if (versionsRes.ok) {
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
      const prefix =
        !versionsRes.ok && versionsRes.status !== topicRes.status
          ? `versions HTTP ${versionsRes.status}\n`
          : !versionsRes.ok
            ? `HTTP ${versionsRes.status}\n`
            : "";
      setResult(`${prefix}${formatted}`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function savePolicyJson() {
    if (!policyTargetId?.trim()) {
      setPolicyMsg("先点某一行的「policy」选中 topicVersionId");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(policyDraft);
    } catch {
      setPolicyMsg("policyJson 不是合法 JSON");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setPolicyMsg("policyJson 须为对象");
      return;
    }
    setPolicySaving(true);
    setPolicyMsg("");
    try {
      const res = await fetch(nestTopicVersionPolicyUrl(policyTargetId.trim()), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyJson: parsed }),
      });
      const text = await res.text();
      setPolicyMsg(`${res.status} ${text.slice(0, 2000)}`);
      if (res.ok) void load();
    } catch (e) {
      setPolicyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPolicySaving(false);
    }
  }

  const lb = leaderboardPreview;

  return (
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">话题版本</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.topic}</code> ·{" "}
          <code className="rounded bg-muted px-1">PATCH {NEST_V1_DOC.topic}</code> ·{" "}
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.topicsVersions}</code> ·{" "}
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.topicsLeaderboard}</code> ·{" "}
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.topicsTrendAnalyses}</code> ·{" "}
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.topicsSnapshots}</code> ·{" "}
          <code className="rounded bg-muted px-1">PATCH {NEST_V1_DOC.topicVersionPolicy}</code>
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
              ?slug=&amp;version=&amp;timeWindow=&amp;windowStart=&amp;includeAiStats=
            </code>
            （热榜查询串与 API 一致）。在 slug 或热榜参数框内按{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-xs">Enter</kbd>{" "}
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

          <div
            className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4"
            aria-labelledby="topic-kind-heading"
          >
            <div>
              <h2
                id="topic-kind-heading"
                className="text-sm font-medium text-foreground"
              >
                话题属性（TopicKind）
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                物化排行时与 <code className="rounded bg-muted px-1">policyJson</code>{" "}
                合并默认权重与衰减；显式 policy 字段仍优先。
                {topicMeta ? (
                  <span className="ml-1 font-mono text-xs">
                    topicId={topicMeta.id}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="topic-kind">TopicKind</Label>
                <select
                  id="topic-kind"
                  className={selectClass}
                  value={topicKindDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isTopicKindValue(v)) setTopicKindDraft(v);
                  }}
                >
                  {TOPIC_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} ({o.value})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {
                    TOPIC_KIND_OPTIONS.find((o) => o.value === topicKindDraft)
                      ?.hint
                  }
                </p>
                {topicMeta?.kindStrategy ? (
                  <div className="mt-2 rounded-md border border-border/80 bg-background/80 p-2 text-xs text-muted-foreground">
                    <p>{topicMeta.kindStrategy.description}</p>
                    <p className="mt-1 font-mono">
                      必选: {topicMeta.kindStrategy.requiredSignalKeys.join(", ")}
                    </p>
                    <p className="font-mono">
                      覆盖率 ≥ {topicMeta.kindStrategy.minCoverageToRank} · 半衰期{" "}
                      {topicMeta.kindStrategy.decay?.halfLifeDays ?? "—"}d
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="topic-title">标题 title</Label>
                <Input
                  id="topic-title"
                  maxLength={200}
                  value={topicTitleDraft}
                  onChange={(e) => setTopicTitleDraft(e.target.value)}
                  placeholder={topicMeta?.title ?? "话题展示名"}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={topicSaving || !topicMeta}
                onClick={() => void saveTopicMeta()}
              >
                {topicSaving ? "保存中…" : "保存话题属性"}
              </Button>
              <CopyTextButton
                text={nestTopicUrl(slugForApi)}
                idleLabel="复制 GET topic URL"
                className="h-8"
              />
              {topicMsg ? (
                <span className="text-xs text-muted-foreground" role="status">
                  {topicMsg}
                </span>
              ) : null}
            </div>
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
          <p className="text-xs leading-relaxed text-muted-foreground">
            填写 <code className="rounded bg-muted px-1">windowStart</code> 时必须同时填写{" "}
            <code className="rounded bg-muted px-1">timeWindow</code>
            （REALTIME / DAY / WEEK / MONTH / YEAR / CUSTOM）。
          </p>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="lb-include-ai-stats"
              className="size-4 rounded border border-input accent-primary"
              checked={lbIncludeAiStats}
              onChange={(e) => setLbIncludeAiStats(e.target.checked)}
            />
            <Label htmlFor="lb-include-ai-stats" className="text-sm font-normal text-muted-foreground">
              热榜 JSON 含 AI 简报统计（<code className="rounded bg-muted px-1 text-xs">includeAiStats=1</code>
              ，与 <code className="rounded bg-muted px-1 text-xs">GET /v1/snapshots/:id</code> 一致）
            </Label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="lb-realtime-sse"
                className="size-4 rounded border border-input accent-primary"
                checked={lbRealtimeSse}
                onChange={(e) => setLbRealtimeSse(e.target.checked)}
              />
              <Label htmlFor="lb-realtime-sse" className="text-sm font-normal text-muted-foreground">
                热榜实时刷新（<code className="rounded bg-muted px-1 text-xs">GET {NEST_V1_DOC.realtimeStream}</code>
                ，需 Redis；当前 slug=<code className="rounded bg-muted px-1 text-xs">{slugForApi}</code>）
              </Label>
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              SSE：
              {lbSseState === "off" && "未订阅"}
              {lbSseState === "connecting" && "连接中…"}
              {lbSseState === "open" && "已连接"}
              {lbSseState === "error" && "连接异常（将自动重试）"}
            </p>
          </div>
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
                {lb.resolved.hasScoreModel === true ? (
                  <> · ScoreModel 已接</>
                ) : lb.resolved.hasScoreModel === false ? (
                  <> · ScoreModel 未接</>
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
                <a
                  href={nestSnapshotScoreBreakdownsUrl(lb.resolved.snapshotId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  GET score-breakdowns
                </a>
                <CopyTextButton
                  text={nestSnapshotScoreBreakdownsUrl(lb.resolved.snapshotId)}
                  idleLabel="复制 score-breakdowns URL"
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
                              <div className="mt-0.5 text-xs">
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
                                  className="h-5 px-2 text-xs"
                                />
                                <CopyTextButton
                                  text={abs(
                                    entitiesAdminPrefillPath(row.canonicalName),
                                  )}
                                  idleLabel="复制实体页"
                                  className="h-5 px-2 text-xs"
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
                    <th scope="col" className="px-3 py-2 font-medium">frozen</th>
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
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.frozen ? "是" : "否"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                          <button
                            type="button"
                            className="text-xs text-primary underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
                            disabled={r.frozen}
                            onClick={() => {
                              setPolicyTargetId(r.id);
                              setPolicyMsg("");
                            }}
                          >
                            policy
                          </button>
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
                          <CopyTextButton
                            text={nestTopicVersionPolicyUrl(r.id)}
                            idleLabel="复制 PATCH URL"
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

      {versionRows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">policyJson（TopicVersion）</CardTitle>
            <CardDescription>
              点版本表中某一行的 <code className="text-xs">policy</code> 加载 JSON；保存走{" "}
              <code className="text-xs">PATCH {NEST_V1_DOC.topicVersionPolicy}</code>
              ，服务端校验 <code className="text-xs">weights</code> / <code className="text-xs">entityIds</code> /
              <code className="text-xs">requiredSignalKeys</code>。<code className="text-xs">frozen</code>{" "}
              版本不可改。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              当前选中 topicVersionId：{" "}
              <code className="rounded bg-muted px-1">{policyTargetId ?? "—"}</code>
            </p>
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium text-foreground">快捷编辑</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                四路权重与演示 seed 一致；其它 <code className="text-xs">weights</code> 键请用下方
                JSON。先改表单再点「表单 → 写入 JSON」，或改 JSON 后点「JSON → 读回表单」。
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {POLICY_METRIC_KEYS.map((key) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={`policy-w-${key}`} className="text-xs capitalize">
                      weight · {key}
                    </Label>
                    <Input
                      id={`policy-w-${key}`}
                      inputMode="decimal"
                      className="h-8 text-xs"
                      value={quickWeights[key]}
                      onChange={(e) =>
                        setQuickWeights((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      disabled={!policyTargetId}
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label htmlFor="policy-entity-ids" className="text-xs">
                  entityIds（逗号或空格分隔；留空则 PATCH 时去掉该字段，由后端按 metrics 推断）
                </Label>
                <Input
                  id="policy-entity-ids"
                  className="h-8 font-mono text-xs"
                  value={quickEntityIds}
                  onChange={(e) => setQuickEntityIds(e.target.value)}
                  disabled={!policyTargetId}
                  placeholder="1, 2, 3"
                />
              </div>
              <fieldset className="space-y-2" disabled={!policyTargetId}>
                <legend className="text-xs text-muted-foreground">
                  requiredSignalKeys
                </legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {POLICY_METRIC_KEYS.map((key) => (
                    <label
                      key={key}
                      className="inline-flex cursor-pointer items-center gap-1.5 text-xs"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-input"
                        checked={quickRequired.includes(key)}
                        onChange={(e) => {
                          setQuickRequired((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, key])]
                              : prev.filter((x) => x !== key),
                          );
                        }}
                      />
                      <span className="capitalize">{key}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!policyTargetId}
                  onClick={() => mergeQuickFormIntoPolicyDraft()}
                >
                  表单 → 写入 JSON
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!policyTargetId}
                  onClick={() => applyJsonTextToQuickForm(policyDraft)}
                >
                  JSON → 读回表单
                </Button>
              </div>
            </div>
            <textarea
              className="min-h-[220px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              spellCheck={false}
              value={policyDraft}
              onChange={(e) => setPolicyDraft(e.target.value)}
              disabled={!policyTargetId}
              aria-label="policyJson 编辑文本框"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={policySaving || !policyTargetId}
                onClick={() => void savePolicyJson()}
              >
                {policySaving ? "保存中…" : "PATCH 保存"}
              </Button>
              {policyTargetId ? (
                <CopyTextButton
                  text={nestTopicVersionPolicyUrl(policyTargetId)}
                  idleLabel="复制 PATCH URL"
                  className="h-9"
                />
              ) : null}
            </div>
            {policyMsg ? (
              <pre className="max-h-[200px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs whitespace-pre-wrap">
                {policyMsg}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快照趋势摘要</CardTitle>
          <CardDescription>
            来自 <code className="text-xs">TrendAnalysis</code>（每次成功物化快照写入）。随上方 slug
            自动刷新；可选 query：<code className="text-xs">timeWindow</code>、
            <code className="text-xs">limit</code>（1–100）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <a
              href={trendAnalysesApiUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              新标签打开 JSON
            </a>
            <CopyTextButton
              text={trendAnalysesApiUrl}
              idleLabel="复制 API URL"
              className="h-6"
            />
            {trendLoading ? <span>加载中…</span> : null}
          </p>
          {trendRows.length === 0 && !trendLoading ? (
            <p className="text-sm text-muted-foreground">
              暂无记录。请先对话题跑榜生成快照（<code className="rounded bg-muted px-1 text-xs">POST {ADMIN_HREF.rankingsRun}</code>
              ）。
            </p>
          ) : null}
          {trendRows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      时间
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      window
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      摘要
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {" "}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trendRows.map((row) => {
                    const pv = parseTrendPayloadPreview(row.payload);
                    const snapId = pv.snapshotId;
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-border/60 last:border-0"
                      >
                        <th
                          scope="row"
                          className="whitespace-nowrap px-3 py-2 font-normal text-muted-foreground"
                        >
                          {row.createdAt}
                        </th>
                        <td className="px-3 py-2">{row.window}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {pv.itemCount != null ? <>条目 {pv.itemCount}</> : null}
                          {pv.avgConfidence != null ? (
                            <>
                              {pv.itemCount != null ? " · " : null}
                              置信 {pv.avgConfidence.toFixed(2)}
                            </>
                          ) : null}
                          {pv.topGainerNames.length > 0 ? (
                            <>
                              {(pv.itemCount != null || pv.avgConfidence != null
                                ? " · "
                                : "")}
                              涨 {pv.topGainerNames.join("、")}
                            </>
                          ) : null}
                          {pv.itemCount == null &&
                          pv.avgConfidence == null &&
                          pv.topGainerNames.length === 0
                            ? "—"
                            : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {snapId ? (
                            <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                              <Link
                                href={snapshotDetailAdminPath(snapId)}
                                className="text-primary underline-offset-2 hover:underline"
                              >
                                快照
                              </Link>
                              <CopyTextButton
                                text={abs(snapshotDetailAdminPath(snapId))}
                                idleLabel="复制快照页"
                                className="h-6 px-2 text-xs"
                              />
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">近期快照</CardTitle>
          <CardDescription>
            <code className="text-xs">TopicRankSnapshot</code> 列表（按{" "}
            <code className="text-xs">snapshotTime</code> 倒序）。每条含{" "}
            <code className="text-xs">aiAnalysisCount</code>、
            <code className="text-xs">hasFollowupBrief</code>、
            <code className="text-xs">hasTrendBrief</code>、
            <code className="text-xs">hasCredibilityBrief</code>、
            <code className="text-xs">hasFactCheckBrief</code> 等七类简报标记、
            <code className="text-xs">hasScoreModel</code>
            （新物化快照已接 <code className="text-xs">ScoreModel</code>）。可选 query：
            <code className="text-xs">timeWindow</code>、<code className="text-xs">limit</code>（1–100）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <a
              href={topicSnapshotsApiUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              新标签打开 JSON
            </a>
            <CopyTextButton
              text={topicSnapshotsApiUrl}
              idleLabel="复制 API URL"
              className="h-6"
            />
            {snapshotLoading ? <span>加载中…</span> : null}
          </p>
          {snapshotRows.length === 0 && !snapshotLoading ? (
            <p className="text-sm text-muted-foreground">暂无快照。</p>
          ) : null}
          {snapshotRows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      snapshotTime
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      window
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      version
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      置信
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Ai 条
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      跟进
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      趋势
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      可信
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      核查
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      涨榜
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      时序
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      排行
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      模型
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {" "}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/60 last:border-0"
                    >
                      <th
                        scope="row"
                        className="whitespace-nowrap px-3 py-2 font-normal text-muted-foreground"
                      >
                        {row.snapshotTime}
                      </th>
                      <td className="px-3 py-2">{row.topicRanking.timeWindow}</td>
                      <td className="max-w-[8rem] truncate px-3 py-2 text-xs">
                        {row.topicRanking.topicVersionLabel}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.confidenceScore.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {row.aiAnalysisCount ?? 0}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {briefCell(row.hasFollowupBrief)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {briefCell(row.hasTrendBrief)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {briefCell(row.hasCredibilityBrief)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {briefCell(row.hasFactCheckBrief)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {briefCell(row.hasTrendAnalysisBrief)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {briefCell(row.hasTimeSeriesBrief)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {briefCell(row.hasRankingBrief)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.hasScoreModel === true ? "是" : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                          <a
                            href={nestSnapshotScoreBreakdownsUrl(row.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            分解
                          </a>
                          <CopyTextButton
                            text={nestSnapshotScoreBreakdownsUrl(row.id)}
                            idleLabel="复制分解 API"
                            className="h-6 px-2 text-xs"
                          />
                          <Link
                            href={snapshotDetailAdminPath(row.id)}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            管理台
                          </Link>
                          <CopyTextButton
                            text={abs(snapshotDetailAdminPath(row.id))}
                            idleLabel="复制快照页"
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
        <div className="w-full max-w-none p-6 text-sm text-muted-foreground">
          加载…
        </div>
      }
    >
      <TopicsPageInner />
    </Suspense>
  );
}
