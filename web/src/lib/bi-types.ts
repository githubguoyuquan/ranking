export type OpsAlert = {
  code: string;
  severity: "ok" | "warn" | "critical";
  message: string;
  value?: number;
  threshold?: number;
};

export type TrendAlert = {
  code: string;
  severity: "warn" | "critical";
  message: string;
  topicId?: string;
  topicSlug?: string;
  entityId?: string;
  entityName?: string;
  value?: number;
  threshold?: number;
  detectedAt?: string;
};

export type BiOverview = {
  generatedAt: string;
  sections?: Record<string, { status: "ok" | "stale" | "unavailable"; sampledAt: string | null }>;
  observability?: {
    status: "ok" | "warn" | "critical" | "unavailable";
    alerts: OpsAlert[];
    outbox?: unknown;
    crawl?: unknown;
  };
  trends?: {
    status: "ok" | "warn" | "critical" | "unavailable";
    alerts: TrendAlert[];
    anomalyCount: number | null;
    scannedAnalyses: number | null;
    thresholds?: Record<string, number>;
  };
  kpis: {
    topics: number;
    entities: number;
    snapshotsTotal: number;
    snapshotsLast24h: number;
    outboxPending: number;
    crawlTasksLast24h: number;
    aiAnalysesToday: number;
    rankingQueue: Record<string, number>;
    scheduleEnabledSources?: number;
    scheduleRuns24h?: number;
    searchPrimary?: string;
  };
  crawlGlobal?: {
    scheduler?: {
      enabled: boolean;
      region: string | null;
      enabledSources: number;
      runsLast24h: number;
    };
    tasksByStatus: Record<string, number>;
    sourcesByRegion: Array<{ region: string; count: number }>;
  };
  searchScale?: {
    primary: string;
    elasticsearch: Record<string, unknown>;
    qdrantConfigured: boolean;
  };
  health: {
    postgresql: { ok: boolean };
    redis: { ok: boolean; detail?: string };
    clickhouse: { ok: boolean; detail?: string };
    kafka: { ok: boolean; configured: boolean; detail?: string };
    elasticsearch: { ok: boolean; detail?: string; clusterName?: string };
  };
  charts: {
    snapshotsByDay: Array<{ day: string; count: number }>;
    trendTypeMix: Array<{ trendType: string; count: number }>;
    clickhouseTopicPopularity?: Array<{
      day: string;
      topic_id: number;
      avg_value: number;
      sample_count: number;
      topicSlug?: string | null;
      topicTitle?: string | null;
    }>;
    clickhouseMv?: {
      ok: boolean;
      mvExists: boolean;
      tables: Array<{ name: string; rows: number }>;
      detail?: string;
    };
    outboxPendingByType?: Array<{ type: string; count: number }>;
  };
  hotMovers: Array<{
    entityId: string;
    canonicalName: string;
    totalRankGain: number;
    mentions: number;
    topicSlugs: string[];
  }>;
  recentSnapshots: Array<{
    snapshotId: string;
    snapshotTime: string;
    confidenceScore: number;
    generatedByAi: boolean;
    itemCount: number;
    aiAnalysisCount: number;
    timeWindow: string;
    rankingStatus: string;
    topicSlug: string;
    topicTitle: string;
    topicKind: string;
    version: string;
  }>;
};
