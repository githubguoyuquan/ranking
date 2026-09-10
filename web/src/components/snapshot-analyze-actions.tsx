"use client";

import {
  AGENT_MAX,
  CHAIN_CONTEXT_MAX,
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
import { nestSnapshotAnalysesUrl, nestSnapshotScoreBreakdownsUrl } from "@/lib/nest-api-urls";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function SnapshotAnalyzeActions(props: SnapshotAnalyzeActionsProps) {
  const { snapshotId, analysesGetUrl: analysesGetUrlProp } = props;
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [agent, setAgent] = useState("");
  const [topNInput, setTopNInput] = useState("");
  const [chainContext, setChainContext] = useState("");

  const analyzePostUrl = useMemo(
    () => adminSnapshotAnalyzeUrl(snapshotId),
    [snapshotId],
  );
  const analysesGetUrl = useMemo(
    () => analysesGetUrlProp ?? nestSnapshotAnalysesUrl(snapshotId),
    [analysesGetUrlProp, snapshotId],
  );
  const scoreBreakdownsUrl = useMemo(
    () => nestSnapshotScoreBreakdownsUrl(snapshotId),
    [snapshotId],
  );

  async function run() {
    const topNParsed = parseOptionalTopN(topNInput);
    if (!topNParsed.ok) {
      setText(topNParsed.message);
      return;
    }
    if (chainContext.length > CHAIN_CONTEXT_MAX) {
      setText(`chainContext 过长：最多 ${CHAIN_CONTEXT_MAX} 字符`);
      return;
    }
    const body: AnalyzeRequestBody = {};
    const a = agent.trim();
    if (a !== "") body.agent = a;
    if (topNParsed.value != null) body.topN = topNParsed.value;
    const cc = chainContext.trim();
    if (cc !== "") body.chainContext = cc;

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
      if (res.ok) {
        router.refresh();
      }
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
        <a
          href={scoreBreakdownsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          GET score-breakdowns
        </a>
        <CopyTextButton
          text={scoreBreakdownsUrl}
          idleLabel="复制 score-breakdowns URL"
          className="h-7"
        />
        <CopyTextButton text={analyzePostUrl} idleLabel="复制 POST URL" className="h-7" />
        <span className="text-xs text-muted-foreground">
          POST {BACKEND_ADMIN_DOC.snapshotAnalyze}；body 可选 agent（≤{AGENT_MAX}）、topN（{TOPN_MIN}–{TOPN_MAX}）、chainContext（≤{CHAIN_CONTEXT_MAX}）；
          使用项目内规则生成；约定 agent：rules-v1、post-snapshot-summary-v1、trend-v1、credibility-v1
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
            placeholder="留空则 rules-v1（服务端默认）"
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
      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor="snapshot-analyze-chain">chainContext（可选，模拟流水线上文）</Label>
        <textarea
          id="snapshot-analyze-chain"
          value={chainContext}
          onChange={(e) => setChainContext(e.target.value)}
          maxLength={CHAIN_CONTEXT_MAX}
          placeholder="留空则无；填写后作为项目内分析步骤的前序摘要"
          disabled={loading}
          autoComplete="off"
          rows={3}
          className={cn(
            "min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          )}
        />
        <p className="text-xs text-muted-foreground">
          {chainContext.length}/{CHAIN_CONTEXT_MAX}
        </p>
      </div>
      {text ? (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
          {text}
        </pre>
      ) : null}
    </div>
  );
}
