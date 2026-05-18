/** Redis `PUBLISH` / SSE `data` JSON（单行） */
export type RealtimeRankingEvent =
  | {
      type: 'snapshot_ready';
      topicSlug: string;
      topicVersionId: string;
      topicRankingId: string;
      snapshotId: string;
      hasScoreModel: boolean;
      deduped?: boolean;
    }
  | {
      type: 'ranking_failed';
      topicSlug: string;
      topicVersionId: string;
      topicRankingId: string;
      error: string;
    }
  | { type: 'ping'; ts: number };
