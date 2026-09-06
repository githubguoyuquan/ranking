"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { SnapshotAnalysesSection, type SnapshotAnalysisListItem } from "./snapshot-analyses-section";
import { SnapshotAnalysesFilter } from "./snapshot-analyses-filter";
import { SnapshotAnalysesPagination } from "./snapshot-analyses-pagination";
import { parseSnapshotPageAnalysisKind, type SnapshotPageAnalysisKind } from "@/lib/snapshot-analysis-kind-query";
import { parseSnapshotAnalysisLimit, parseSnapshotAnalysisPage, snapshotAnalysisListOffset } from "@/lib/snapshot-detail-search-params";
import { nestSnapshotAnalysesUrl } from "@/lib/nest-api-urls";
import { parseSnapshotAnalysesApiResponse } from "@/lib/snapshot-analyses-api";
import { queryJson } from "@/lib/query-http";

type Selection = { kind: SnapshotPageAnalysisKind; page: number; limit: number };
export function SnapshotAnalysesPanel(props: {
  snapshotId: string; initial: Selection; rows: SnapshotAnalysisListItem[];
  total: number | null; error: string | null;
}) {
  const [selection, setSelection] = useState(props.initial);
  const [result, setResult] = useState({ rows: props.rows, total: props.total });
  const [error, setError] = useState(props.error);
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);
  function apiHref(value: Selection) {
    const qs = new URLSearchParams({ limit: String(value.limit), offset: String(snapshotAnalysisListOffset(value.page, value.limit)) });
    if (value.kind) qs.set("agentKind", value.kind);
    return nestSnapshotAnalysesUrl(props.snapshotId, qs);
  }
  const loadRef = useRef<(url: URL) => void>(() => {});
  useEffect(() => {
    loadRef.current = (url: URL) => {
      const value = { kind: parseSnapshotPageAnalysisKind(url.searchParams.get("analysisKind") ?? undefined),
        page: parseSnapshotAnalysisPage(url.searchParams.get("analysisPage") ?? undefined),
        limit: parseSnapshotAnalysisLimit(url.searchParams.get("analysisLimit") ?? undefined) };
      active.current?.abort();
      const controller = new AbortController(); active.current = controller;
      setSelection(value); setLoading(true); setError(null);
      void queryJson(apiHref(value), controller.signal).then(raw => {
        if (!controller.signal.aborted) setResult(parseSnapshotAnalysesApiResponse(raw));
      }).catch(err => {
        if (!controller.signal.aborted) { setResult({ rows: [], total: null }); setError(String(err)); }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    };
  });
  useEffect(() => {
    const pop = () => loadRef.current(new URL(location.href));
    addEventListener("popstate", pop);
    return () => { active.current?.abort(); removeEventListener("popstate", pop); };
  }, []);
  function navigate(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest("a");
    if (!anchor || anchor.target === "_blank") return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
    event.preventDefault(); event.stopPropagation();
    history.pushState(null, "", url);
    loadRef.current(url);
  }
  return <div onClickCapture={navigate} aria-busy={loading}>
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在加载简报…</p> : null}
    <SnapshotAnalysesSection rows={loading ? [] : result.rows} analysesTotal={result.total}
      loadError={error} analysesJsonUrl={apiHref(selection)} filterSlot={<div className="flex flex-wrap gap-3">
        <SnapshotAnalysesFilter snapshotId={props.snapshotId} currentKind={selection.kind} listLimit={selection.limit} />
        <SnapshotAnalysesPagination snapshotId={props.snapshotId} analysisKind={selection.kind} page={selection.page} limit={selection.limit} total={result.total} />
        {error ? <button type="button" onClick={() => loadRef.current(new URL(location.href))}>重试</button> : null}
      </div>} />
  </div>;
}
