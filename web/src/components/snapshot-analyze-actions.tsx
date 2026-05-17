"use client";

import { Button } from "@/components/ui/button";
import { getApiBase } from "@/lib/api";
import { useState } from "react";

export function SnapshotAnalyzeActions({ snapshotId }: { snapshotId: string }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");

  async function run() {
    setLoading(true);
    setText("");
    try {
      const res = await fetch(
        `${getApiBase()}/admin/snapshots/${encodeURIComponent(snapshotId)}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const raw = await res.text();
      setText(`${res.ok ? "" : `HTTP ${res.status}\n`}${raw}`);
    } catch (e) {
      setText(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/80 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">AI 简报（Agent）</span>
        <Button type="button" size="sm" disabled={loading} onClick={() => void run()}>
          {loading ? "生成中…" : "生成 AiAnalysis"}
        </Button>
        <span className="text-xs text-muted-foreground">
          POST /admin/snapshots/:id/analyze；可选 OPENAI_API_KEY 润色
        </span>
      </div>
      {text ? (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
          {text}
        </pre>
      ) : null}
    </div>
  );
}
