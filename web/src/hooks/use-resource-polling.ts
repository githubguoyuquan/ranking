"use client";
import { useCallback, useEffect, useRef } from "react";
import { startResourcePolling } from "@/lib/resource-polling";

export function useResourcePolling(run: (signal: AbortSignal) => Promise<void>, options: {
  key: string; enabled: boolean; intervalMs: number;
}) {
  const latest = useRef({ run, intervalMs: options.intervalMs });
  const poll = useRef<ReturnType<typeof startResourcePolling> | null>(null);
  useEffect(() => { latest.current = { run, intervalMs: options.intervalMs }; });
  useEffect(() => {
    if (!options.enabled) return;
    const resource = startResourcePolling({
      run: signal => latest.current.run(signal), delay: () => latest.current.intervalMs,
      visible: () => document.visibilityState !== "hidden",
      subscribe: wake => { document.addEventListener("visibilitychange", wake); return () => document.removeEventListener("visibilitychange", wake); },
    });
    poll.current = resource;
    return () => { resource.stop(); if (poll.current === resource) poll.current = null; };
  }, [options.key, options.enabled]);
  return useCallback(() => poll.current?.refresh(), []);
}
