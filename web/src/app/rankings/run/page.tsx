"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { getApiBase } from "@/lib/api";
import Link from "next/link";
import { useState } from "react";

const defaults = {
  topicVersionId: "1",
  timeWindow: "WEEK",
  windowStart: "2026-05-10T00:00:00.000Z",
  windowEnd: "2026-05-17T00:00:00.000Z",
  asOf: "2026-05-21T12:00:00.000Z",
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function formatMaybeJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

type EnqueueResponse = {
  jobId?: string;
  topicRankingId?: string;
  dedupedSnapshot?: boolean;
  snapshotId?: string;
};

type JobPollBody = {
  id?: string;
  state?: string;
  attemptsMade?: number;
  failedReason?: string;
  returnvalue?: unknown;
};

function formatTopicRankingStatus(text: string): string {
  try {
    const o = JSON.parse(text) as {
      status?: string;
      lastError?: string | null;
      snapshots?: Array<{ id: string | number | bigint }>;
    };
    const lines = [`DB status=${o.status ?? "?"}`];
    if (o.lastError) lines.push(`lastError: ${o.lastError}`);
    const sid = o.snapshots?.[0]?.id;
    if (sid != null) lines.push(`latestSnapshotId: ${String(sid)}`);
    return lines.join("\n");
  } catch {
    return text;
  }
}

export default function RunRankingPage() {
  const [topicVersionId, setTopicVersionId] = useState(defaults.topicVersionId);
  const [timeWindow, setTimeWindow] = useState(defaults.timeWindow);
  const [windowStart, setWindowStart] = useState(defaults.windowStart);
  const [windowEnd, setWindowEnd] = useState(defaults.windowEnd);
  const [asOf, setAsOf] = useState(defaults.asOf);
  const [asyncMode, setAsyncMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  async function submit() {
    setLoading(true);
    setResult("");
    const body = {
      topicVersionId,
      timeWindow,
      windowStart,
      windowEnd,
      asOf: asOf || undefined,
      async: asyncMode,
    };
    try {
      const res = await fetch(`${getApiBase()}/v1/rankings/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();

      if (!asyncMode) {
        setResult(
          `${res.ok ? "" : `HTTP ${res.status}\n`}${formatMaybeJson(text)}`,
        );
        return;
      }

      if (!res.ok) {
        setResult(`HTTP ${res.status}\n${formatMaybeJson(text)}`);
        return;
      }

      let enq: EnqueueResponse;
      try {
        enq = JSON.parse(text) as EnqueueResponse;
      } catch {
        setResult(text);
        return;
      }

      if (enq.dedupedSnapshot) {
        const snap = enq.snapshotId;
        setResult(
          [
            "已有同窗口快照，未重新入队。",
            formatMaybeJson(text),
            ...(snap ? ["", `打开快照：/snapshots/${snap}`] : []),
          ].join("\n"),
        );
        return;
      }

      const jobId = enq.jobId;
      const topicRankingId = enq.topicRankingId;
      if (!jobId || !topicRankingId) {
        setResult(formatMaybeJson(text));
        return;
      }

      const lines: string[] = [
        `已入队 jobId=${jobId}，topicRankingId=${topicRankingId}`,
        "轮询 GET /v1/jobs/ranking/:jobId …",
      ];

      let pollTerminal = false;

      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const poll = await fetch(
          `${getApiBase()}/v1/jobs/ranking/${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );

        if (poll.status === 404) {
          const st = await fetch(
            `${getApiBase()}/v1/rankings/${encodeURIComponent(topicRankingId)}/status`,
            { cache: "no-store" },
          );
          const stText = await st.text();
          if (st.ok) {
            try {
              const row = JSON.parse(stText) as { status?: string };
              if (
                row.status === "completed" ||
                row.status === "failed"
              ) {
                lines.push(
                  `[${i + 1}s] Job 已从队列移除，以 DB 为准：\n${formatTopicRankingStatus(stText)}`,
                );
                lines.push("");
                lines.push(formatMaybeJson(stText));
                pollTerminal = true;
                break;
              }
            } catch {
              /* fall through */
            }
          }
          lines.push(`[${i + 1}s] GET job → 404，TopicRanking 仍未终态，继续…`);
          continue;
        }

        if (!poll.ok) {
          lines.push(
            `[${i + 1}s] GET job HTTP ${poll.status}: ${(await poll.text()).slice(0, 400)}`,
          );
          continue;
        }

        let job: JobPollBody;
        try {
          job = JSON.parse(await poll.text()) as JobPollBody;
        } catch {
          lines.push(`[${i + 1}s] job 响应非 JSON`);
          continue;
        }

        const st = job.state ?? "?";
        lines.push(
          `[${i + 1}s] state=${st} attempts=${job.attemptsMade ?? 0}`,
        );

        if (st === "failed") {
          lines.push(
            job.failedReason
              ? `failedReason: ${job.failedReason}`
              : "failed（无 failedReason）",
          );
          if (job.returnvalue != null) {
            lines.push(`returnvalue:\n${JSON.stringify(job.returnvalue, null, 2)}`);
          }
          pollTerminal = true;
          break;
        }

        if (st === "completed") {
          lines.push("");
          lines.push(
            job.returnvalue != null
              ? JSON.stringify(job.returnvalue, null, 2)
              : "（无 returnvalue）",
          );
          pollTerminal = true;
          break;
        }
      }

      if (!pollTerminal) {
        lines.push("", "已达到轮询上限或未进入终态，请手动查 job 或 TopicRanking。");
      }

      setResult(lines.join("\n"));
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">运行排行</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">POST /v1/rankings/run</code>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">参数</CardTitle>
          <CardDescription>
            需先有演示数据或与后端一致的 topicVersionId
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tv">topicVersionId</Label>
            <Input
              id="tv"
              value={topicVersionId}
              onChange={(e) => setTopicVersionId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tw">timeWindow</Label>
            <Input
              id="tw"
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws">windowStart</Label>
            <Input
              id="ws"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="we">windowEnd</Label>
            <Input
              id="we"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="asof">asOf（可选）</Label>
            <Input id="asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={asyncMode}
              onChange={(e) => setAsyncMode(e.target.checked)}
            />
            异步（BullMQ 入队）
          </label>

          <Button disabled={loading} onClick={() => void submit()}>
            {loading
              ? asyncMode
                ? "轮询中…"
                : "提交中…"
              : "运行"}
          </Button>

          {asyncMode ? (
            <Alert>
              <AlertTitle>异步模式</AlertTitle>
              <AlertDescription>
                提交后会轮询{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  GET /v1/jobs/ranking/:jobId
                </code>
                ；若任务因{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  removeOnComplete
                </code>{" "}
                从 Redis 消失，会改查{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  GET /v1/rankings/:topicRankingId/status
                </code>
                。
              </AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              {result}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
        ← 返回概览
      </Link>
    </div>
  );
}
