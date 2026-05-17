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
    try {
      const body = {
        topicVersionId,
        timeWindow,
        windowStart,
        windowEnd,
        asOf: asOf || undefined,
        async: asyncMode,
      };
      const res = await fetch(`${getApiBase()}/v1/rankings/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        formatted = text;
      }
      setResult(`${res.ok ? "" : `HTTP ${res.status}\n`}${formatted}`);
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
            {loading ? "提交中…" : "运行"}
          </Button>

          {asyncMode ? (
            <Alert>
              <AlertTitle>异步模式</AlertTitle>
              <AlertDescription>
                返回 jobId 后可用{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  GET /v1/jobs/ranking/:jobId
                </code>
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
