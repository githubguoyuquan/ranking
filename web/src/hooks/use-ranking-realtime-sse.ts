"use client";

import { getApiBase } from "@/lib/api";
import { nestV1RealtimeStreamPath } from "@/lib/nest-api-paths";
import { useEffect, useRef, useState } from "react";

export type SnapshotReadySsePayload = {
  type: "snapshot_ready";
  topicSlug: string;
  topicVersionId: string;
  topicRankingId: string;
  snapshotId: string;
  hasScoreModel: boolean;
  deduped?: boolean;
};

export type RankingFailedSsePayload = {
  type: "ranking_failed";
  topicSlug: string;
  topicVersionId: string;
  topicRankingId: string;
  error: string;
};

type SsePayload =
  | SnapshotReadySsePayload
  | RankingFailedSsePayload
  | { type: "ping"; ts: number };

function buildRealtimeUrl(opts: {
  topics?: string[];
  topicRankingIds?: string[];
}): string | null {
  const q = new URLSearchParams();
  if (opts.topics?.length) q.set("topics", opts.topics.join(","));
  if (opts.topicRankingIds?.length) {
    q.set("topicRankingIds", opts.topicRankingIds.join(","));
  }
  if (q.toString() === "") return null;
  return `${getApiBase()}${nestV1RealtimeStreamPath(q)}`;
}

export function useRankingRealtimeSse(opts: {
  topics?: string[];
  topicRankingIds?: string[];
  enabled?: boolean;
  onSnapshotReady?: (p: SnapshotReadySsePayload) => void;
  onRankingFailed?: (p: RankingFailedSsePayload) => void;
}): { connectionState: "off" | "connecting" | "open" | "error" } {
  const {
    topics = [],
    topicRankingIds = [],
    enabled = true,
    onSnapshotReady,
    onRankingFailed,
  } = opts;
  const [connectionState, setConnectionState] = useState<
    "off" | "connecting" | "open" | "error"
  >("off");
  const readyRef = useRef(onSnapshotReady);
  const failedRef = useRef(onRankingFailed);
  readyRef.current = onSnapshotReady;
  failedRef.current = onRankingFailed;

  const topicsKey = topics.join("\u0001");
  const trKey = topicRankingIds.join("\u0001");

  useEffect(() => {
    if (!enabled) {
      setConnectionState("off");
      return;
    }
    const url = buildRealtimeUrl({ topics, topicRankingIds });
    if (!url) {
      setConnectionState("off");
      return;
    }

    setConnectionState("connecting");
    const es = new EventSource(url);

    es.onopen = () => setConnectionState("open");

    es.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data) as SsePayload;
        if (j.type === "snapshot_ready") readyRef.current?.(j);
        else if (j.type === "ranking_failed") failedRef.current?.(j);
      } catch {
        /* ignore */
      }
    };

    es.onerror = () => {
      setConnectionState((prev) => (prev === "open" ? "open" : "error"));
    };

    return () => {
      es.close();
      setConnectionState("off");
    };
    // topicsKey / trKey 已编码数组内容，避免引用抖动导致反复断连
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [enabled, topicsKey, trKey]);

  return { connectionState };
}
