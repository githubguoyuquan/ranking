export type BiOverview = {
  generatedAt: string;
  kpis: {
    topics: number;
    entities: number;
    snapshotsTotal: number;
    snapshotsLast24h: number;
    outboxPending: number;
    crawlTasksLast24h: number;
    aiAnalysesToday: number;
    rankingQueue: Record<string, number>;
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
