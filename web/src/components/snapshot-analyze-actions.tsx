"use client";

import {
  AGENT_MAX,
  TOPN_INPUT_MAX_LEN,
  TOPN_MAX,
  TOPN_MIN,
  type AnalyzeRequestBody,
  parseOptionalTopN,
  type SnapshotAnalyzeActionsProps,
} from "@/components/snapshot-analyze-model";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminSnapshotAnalyzeUrl } from "@/lib/backend-api-urls";
import { BACKEND_ADMIN_DOC } from "@/lib/backend-api-paths";
import { nestSnapshotAnalysesUrl } from "@/lib/nest-api-urls";
import { useMemo, useState } from "react";

export function SnapshotAnalyzeActions(props: SnapshotAnalyzeActionsProps) {
  const { snapshotId } = props;
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [agent, setAgent] = useState("");
  const [topNInput, setTopNInput] = useState("");

  const analyzePostUrl = useMemo(
    () => adminSnapshotAnalyzeUrl(snapshotId),
    [snapshotId],
  );
  const analysesGetUrl = useMemo(
    () => nestSnapshotAnalysesUrl(snapshotId),
    [snapshotId],
  );

  async function run() {
    const topNParsed = parseOptionalTopN(topNInput);
    if (!topNParsed.ok) {
      setText(topNParsed.message);
      return;
    }
    const body: AnalyzeRequestBody = {};
    const a = agent.trim();
    if (a !== "") body.agent = a;
    if (topNParsed.value != null) body.topN = topNParsed.value;

    setLoading(true);
    setText("");
    try {
      const res = await fetch(analyzePostUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      setText(`${res.ok ? "" : `HTTP ${res.status}\n`}${raw}`);
    } catch (e) {
      setText(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="rounded-lg border border-border/80 bg-muted/20 p-4"
      aria-busy={loading}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span id="snapshot-analyze-title" className="text-sm font-medium">
          AI 简报（Agent）
        </span>
        <Button
          type="button"
          size="sm"
          disabled={loading}
          onClick={() => void run()}
          aria-labelledby="snapshot-analyze-title"
        >
          {loading ? "生成中…" : "生成 AiAnalysis"}
        </Button>
        <a
          href={analysesGetUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          GET 已有简报（新标签打开 JSON）
        </a>
        <CopyTextButton text={analysesGetUrl} idleLabel="复制 GET URL" className="h-7" />
        <CopyTextButton text={analyzePostUrl} idleLabel="复制 POST URL" className="h-7" />
        <span className="text-xs text-muted-foreground">
          POST {BACKEND_ADMIN_DOC.snapshotAnalyze}；body 可选 agent（≤{AGENT_MAX}）、topN（{TOPN_MIN}–{TOPN_MAX}）；
          可选 OPENAI_API_KEY 润色
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <Label htmlFor="snapshot-analyze-agent">agent（可选）</Label>
          <Input
            id="snapshot-analyze-agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            maxLength={AGENT_MAX}
            placeholder="默认由服务端选择"
            disabled={loading}
            autoComplete="off"
          />
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor="snapshot-analyze-topn">topN（可选）</Label>
          <Input
            id="snapshot-analyze-topn"
            inputMode="numeric"
            maxLength={TOPN_INPUT_MAX_LEN}
            value={topNInput}
            onChange={(e) => setTopNInput(e.target.value)}
            placeholder={`${TOPN_MIN}–${TOPN_MAX}`}
            disabled={loading}
            autoComplete="off"
          />
        </div>
      </div>
      {text ? (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
          {text}
        </pre>
      ) : null}
    </div>
  );
}
