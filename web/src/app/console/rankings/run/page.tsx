"use client";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
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
import {
  ISO_DATETIME_INPUT_MAX_LEN,
  TIME_WINDOW_INPUT_MAX_LEN,
} from "@/lib/admin-input-limits";
import { snapshotDetailAdminPath, rankingsRunAdminPath } from "@/lib/admin-web-paths";
import {
  DECIMAL_BIGINT_ID_MAX_DIGITS,
  isDecimalBigIntIdString,
} from "@/lib/decimal-id";
import {
  NEST_V1,
  NEST_V1_DOC,
} from "@/lib/nest-api-paths";
import {
  nestRankingJobUrl,
  nestRankingRunUrl,
  nestRankingStatusUrl,
  nestSnapshotScoreBreakdownsUrl,
  nestSnapshotV1Url,
} from "@/lib/nest-api-urls";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { useRankingRealtimeSse } from "@/hooks/use-ranking-realtime-sse";
import { formatTopicRankingStatusSummary } from "@/lib/format-topic-ranking-status";
import { isIsoDateString } from "@/lib/iso-date";
import { TIME_WINDOW_SET } from "@/lib/time-window";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

const defaults = {
  topicVersionId: "",
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
  hasScoreModel?: boolean;
};

type JobPollBody = {
  id?: string;
  state?: string;
  attemptsMade?: number;
  failedReason?: string;
  returnvalue?: unknown;
};

function parseSnapshotIdFromRankingResponse(text: string): string | undefined {
  try {
    const o = JSON.parse(text) as { id?: unknown };
    if (o.id != null && o.id !== "") return String(o.id);
  } catch {
    return undefined;
  }
  return undefined;
}

type RankingQuickOpen = {
  snapshotId: string;
  hasScoreModel?: boolean;
};

function pickQuickOpenFromSyncRankingBody(text: string): RankingQuickOpen | null {
  try {
    const o = JSON.parse(text) as {
      id?: unknown;
      hasScoreModel?: boolean;
    };
    if (o.id != null && o.id !== "") {
      return {
        snapshotId: String(o.id),
        ...(typeof o.hasScoreModel === "boolean"
          ? { hasScoreModel: o.hasScoreModel }
          : {}),
      };
    }
  } catch {
    /* fall through */
  }
  const sid = parseSnapshotIdFromRankingResponse(text);
  return sid ? { snapshotId: sid } : null;
}

function extractQuickOpenFromStatusJson(text: string): RankingQuickOpen | null {
  try {
    const o = JSON.parse(text) as {
      snapshots?: Array<{ id?: unknown; hasScoreModel?: boolean }>;
    };
    const latest = o.snapshots?.[0];
    if (latest?.id == null || latest.id === "") return null;
    return {
      snapshotId: String(latest.id),
      ...(typeof latest.hasScoreModel === "boolean"
        ? { hasScoreModel: latest.hasScoreModel }
        : {}),
    };
  } catch {
    return null;
  }
}

function parseQuickOpenFromJobReturn(value: unknown): RankingQuickOpen | null {
  if (value == null) return null;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.id != null && o.id !== "") {
      return {
        snapshotId: String(o.id),
        ...(typeof o.hasScoreModel === "boolean"
          ? { hasScoreModel: o.hasScoreModel }
          : {}),
      };
    }
    return null;
  }
  if (typeof value === "string") {
    return pickQuickOpenFromSyncRankingBody(value);
  }
  return null;
}

function RunRankingForm() {
  const searchParams = useSearchParams();
  const { abs } = useAdminAppUrl();
  const [topicVersionId, setTopicVersionId] = useState(defaults.topicVersionId);
  const [timeWindow, setTimeWindow] = useState(defaults.timeWindow);
  const [windowStart, setWindowStart] = useState(defaults.windowStart);
  const [windowEnd, setWindowEnd] = useState(defaults.windowEnd);
  const [asOf, setAsOf] = useState(defaults.asOf);
  const [asyncMode, setAsyncMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [quickOpen, setQuickOpen] = useState<RankingQuickOpen | null>(null);
  const [runMeta, setRunMeta] = useState<{
    jobId?: string;
    topicRankingId?: string;
  } | null>(null);

  const runMetaTrRef = useRef<string | undefined>(undefined);
  runMetaTrRef.current = runMeta?.topicRankingId;

  const { connectionState: rankingSseState } = useRankingRealtimeSse({
    topicRankingIds:
      asyncMode && runMeta?.topicRankingId ? [runMeta.topicRankingId] : [],
    enabled: Boolean(asyncMode && runMeta?.topicRankingId),
    onSnapshotReady: (p) => {
      if (p.topicRankingId !== runMetaTrRef.current) return;
      setQuickOpen({
        snapshotId: p.snapshotId,
        hasScoreModel: p.hasScoreModel,
      });
      setResult((prev) =>
        `${prev.trimEnd()}\n\n[SSE] 快照就绪 snapshotId=${p.snapshotId}`,
      );
    },
    onRankingFailed: (p) => {
      if (p.topicRankingId !== runMetaTrRef.current) return;
      setResult((prev) =>
        `${prev.trimEnd()}\n\n[SSE] 物化失败：${p.error}`,
      );
    },
  });

  const runRequestBodyJson = useMemo(
    () =>
      JSON.stringify({
        topicVersionId,
        timeWindow,
        windowStart,
        windowEnd,
        asOf: asOf || undefined,
        async: asyncMode,
      }),
    [
      topicVersionId,
      timeWindow,
      windowStart,
      windowEnd,
      asOf,
      asyncMode,
    ],
  );

  useEffect(() => {
    const tv = searchParams.get("topicVersionId");
    if (tv?.trim()) setTopicVersionId(tv.trim());
  }, [searchParams]);

  async function submit() {
    const tv = topicVersionId.trim();
    if (!tv) {
      setResult("请填写 topicVersionId（可从演示数据、话题版本页或 URL ?topicVersionId= 获得）。");
      return;
    }
    if (!isDecimalBigIntIdString(tv)) {
      setResult(
        `topicVersionId 须为十进制 TopicVersion 主键（至多 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位数字），与后端 BigInt 解析一致。`,
      );
      return;
    }
    const tw = timeWindow.trim();
    if (!TIME_WINDOW_SET.has(tw)) {
      setResult(
        `timeWindow 须为 ${[...TIME_WINDOW_SET].join(" / ")} 之一（与后端 Prisma TimeWindow 一致）。`,
      );
      return;
    }
    const ws = windowStart.trim();
    const we = windowEnd.trim();
    if (!isIsoDateString(ws) || !isIsoDateString(we)) {
      setResult(
        "windowStart 与 windowEnd 须为可被解析的 ISO 8601 日期时间（例如 2026-05-10T00:00:00.000Z）。",
      );
      return;
    }
    const asOfTrim = asOf.trim();
    if (asOfTrim && !isIsoDateString(asOfTrim)) {
      setResult(
        "asOf 若填写，须为可被解析的 ISO 8601 日期时间；留空则省略该字段。",
      );
      return;
    }
    setLoading(true);
    setResult("");
    setQuickOpen(null);
    setRunMeta(null);
    const body = {
      topicVersionId: tv,
      timeWindow: tw,
      windowStart: ws,
      windowEnd: we,
      asOf: asOfTrim || undefined,
      async: asyncMode,
    };
    try {
      const res = await fetch(nestRankingRunUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();

      if (!asyncMode) {
        if (res.ok) {
          const q = pickQuickOpenFromSyncRankingBody(text);
          if (q) setQuickOpen(q);
        }
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
        const snap = enq.snapshotId != null ? String(enq.snapshotId) : "";
        if (snap) {
          setQuickOpen({
            snapshotId: snap,
            ...(typeof enq.hasScoreModel === "boolean"
              ? { hasScoreModel: enq.hasScoreModel }
              : {}),
          });
        }
        const trId =
          enq.topicRankingId != null ? String(enq.topicRankingId) : "";
        if (trId) setRunMeta({ topicRankingId: trId });
        setResult(
          [
            "已有同窗口快照，未重新入队。",
            formatMaybeJson(text),
            ...(snap ? ["", `打开快照：${snapshotDetailAdminPath(snap)}`] : []),
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

      setRunMeta({ jobId, topicRankingId });

      const lines: string[] = [
        `已入队 jobId=${jobId}，topicRankingId=${topicRankingId}`,
        `轮询 GET ${NEST_V1_DOC.jobRanking} …`,
      ];

      let pollTerminal = false;

      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const poll = await fetch(nestRankingJobUrl(jobId), { cache: "no-store" });

        if (poll.status === 404) {
          const st = await fetch(nestRankingStatusUrl(topicRankingId), {
            cache: "no-store",
          });
          const stText = await st.text();
          if (st.ok) {
            try {
              const row = JSON.parse(stText) as { status?: string };
              if (
                row.status === "completed" ||
                row.status === "failed"
              ) {
                lines.push(
                  `[${i + 1}s] Job 已从队列移除，以 DB 为准：\n${formatTopicRankingStatusSummary(stText)}`,
                );
                lines.push("");
                lines.push(formatMaybeJson(stText));
                if (row.status === "completed") {
                  const q = extractQuickOpenFromStatusJson(stText);
                  if (q) setQuickOpen(q);
                }
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
          const q = parseQuickOpenFromJobReturn(job.returnvalue);
          if (q) setQuickOpen(q);
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
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">运行排行</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">POST {NEST_V1.rankingsRun}</code>
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyTextButton
            text={nestRankingRunUrl()}
            idleLabel="复制 POST URL"
            className="h-6"
          />
          <span className="text-muted-foreground/90">须 POST + JSON body</span>
        </p>
        {topicVersionId.trim() ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <CopyTextButton
              text={abs(rankingsRunAdminPath(topicVersionId))}
              idleLabel="复制本页链接"
              className="h-6"
            />
            <span className="text-muted-foreground/90">
              含当前 topicVersionId 查询串
            </span>
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">参数</CardTitle>
          <CardDescription>
            需先有演示数据或与后端一致的 topicVersionId（留空时不提交；填写时须为十进制
            TopicVersion 主键，与后端 <code className="text-xs">BigInt</code> 解析一致，至多{" "}
            <code className="text-xs">{DECIMAL_BIGINT_ID_MAX_DIGITS}</code> 位）。
            <code className="text-xs">timeWindow</code> 须为 REALTIME / DAY / WEEK / MONTH / YEAR /
            CUSTOM（与 Prisma 枚举一致）；<code className="text-xs">windowStart</code>、
            <code className="text-xs">windowEnd</code> 及可选 <code className="text-xs">asOf</code>{" "}
            须为可解析的 ISO 8601 字符串；对应输入框 maxLength{" "}
            <code className="text-xs">{TIME_WINDOW_INPUT_MAX_LEN}</code>（timeWindow）与{" "}
            <code className="text-xs">{ISO_DATETIME_INPUT_MAX_LEN}</code>（三处日期时间）。支持 URL{" "}
            <code className="text-xs">?topicVersionId=</code>
            （话题版本页的「跑榜」会带此参数）。各参数框内{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-xs">Enter</kbd>{" "}
            可提交（同「运行」）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="tv">topicVersionId</Label>
              <CopyTextButton
                text={topicVersionId}
                idleLabel="复制"
                className="h-6 shrink-0"
              />
            </div>
            <Input
              id="tv"
              inputMode="numeric"
              maxLength={DECIMAL_BIGINT_ID_MAX_DIGITS}
              value={topicVersionId}
              onChange={(e) => setTopicVersionId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || loading || !topicVersionId.trim()) return;
                void submit();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tw">timeWindow</Label>
            <Input
              id="tw"
              maxLength={TIME_WINDOW_INPUT_MAX_LEN}
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || loading || !topicVersionId.trim())
                  return;
                void submit();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws">windowStart</Label>
            <Input
              id="ws"
              maxLength={ISO_DATETIME_INPUT_MAX_LEN}
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || loading || !topicVersionId.trim())
                  return;
                void submit();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="we">windowEnd</Label>
            <Input
              id="we"
              maxLength={ISO_DATETIME_INPUT_MAX_LEN}
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || loading || !topicVersionId.trim())
                  return;
                void submit();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="asof">asOf（可选）</Label>
            <Input
              id="asof"
              maxLength={ISO_DATETIME_INPUT_MAX_LEN}
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || loading || !topicVersionId.trim())
                  return;
                void submit();
              }}
            />
          </div>
          <label htmlFor="rankings-async" className="flex items-center gap-2 text-sm">
            <input
              id="rankings-async"
              type="checkbox"
              checked={asyncMode}
              onChange={(e) => setAsyncMode(e.target.checked)}
            />
            异步（BullMQ 入队）
          </label>

          <Button
            disabled={loading || !topicVersionId.trim()}
            onClick={() => void submit()}
          >
            {loading
              ? asyncMode
                ? "轮询中…"
                : "提交中…"
              : "运行"}
          </Button>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>与「运行」相同的 POST 体：</span>
            <CopyTextButton
              text={runRequestBodyJson}
              idleLabel="复制 JSON"
              className="h-6"
            />
          </p>

          {asyncMode ? (
            <Alert>
              <AlertTitle>异步模式</AlertTitle>
              <AlertDescription>
                提交后会轮询{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  GET {NEST_V1_DOC.jobRanking}
                </code>
                ；若任务因{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  removeOnComplete
                </code>{" "}
                从 Redis 消失，会改查{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  GET {NEST_V1_DOC.rankingsStatus}
                </code>
                。入队成功后可并行监听{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  GET {NEST_V1_DOC.realtimeStream}
                </code>
                （<code className="rounded bg-muted px-1 text-xs">topicRankingIds</code>
                ），快照物化完成时抢先推送。
              </AlertDescription>
            </Alert>
          ) : null}

          {runMeta &&
          (runMeta.jobId || runMeta.topicRankingId) ? (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <p className="text-xs leading-relaxed" aria-live="polite">
                实时 SSE（job / ranking）：
                {rankingSseState === "off" && "未订阅"}
                {rankingSseState === "connecting" && "连接中…"}
                {rankingSseState === "open" && "已连接"}
                {rankingSseState === "error" && "连接异常（浏览器会自动重连）"}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {runMeta.jobId ? (
                <>
                  <a
                    href={nestRankingJobUrl(runMeta.jobId)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    GET job（JSON）
                  </a>
                  <CopyTextButton
                    text={nestRankingJobUrl(runMeta.jobId)}
                    idleLabel="复制 job URL"
                    className="h-6"
                  />
                  <CopyTextButton
                    text={runMeta.jobId}
                    idleLabel="复制 jobId"
                    className="h-6"
                  />
                </>
              ) : null}
              {runMeta.jobId && runMeta.topicRankingId ? (
                <span aria-hidden="true">·</span>
              ) : null}
              {runMeta.topicRankingId ? (
                <>
                  <a
                    href={nestRankingStatusUrl(runMeta.topicRankingId)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    GET ranking status（JSON）
                  </a>
                  <CopyTextButton
                    text={nestRankingStatusUrl(runMeta.topicRankingId)}
                    idleLabel="复制 status URL"
                    className="h-6"
                  />
                  <CopyTextButton
                    text={runMeta.topicRankingId}
                    idleLabel="复制 topicRankingId"
                    className="h-6"
                  />
                </>
              ) : null}
              </div>
            </div>
          ) : null}

          {quickOpen?.snapshotId ? (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">快照：</span>
                <Link
                  href={snapshotDetailAdminPath(quickOpen.snapshotId)}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  打开 #{quickOpen.snapshotId}
                </Link>
                <CopyTextButton
                  text={quickOpen.snapshotId}
                  idleLabel="复制 id"
                  className="h-6"
                />
                <CopyTextButton
                  text={abs(snapshotDetailAdminPath(quickOpen.snapshotId))}
                  idleLabel="复制快照页链接"
                  className="h-6"
                />
                <a
                  href={nestSnapshotV1Url(quickOpen.snapshotId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  GET JSON
                </a>
                <CopyTextButton
                  text={nestSnapshotV1Url(quickOpen.snapshotId)}
                  idleLabel="复制快照 JSON URL"
                  className="h-6"
                />
                <a
                  href={nestSnapshotScoreBreakdownsUrl(quickOpen.snapshotId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  GET score-breakdowns
                </a>
                <CopyTextButton
                  text={nestSnapshotScoreBreakdownsUrl(quickOpen.snapshotId)}
                  idleLabel="复制 score-breakdowns URL"
                  className="h-6"
                />
              </div>
              {quickOpen.hasScoreModel === true ? (
                <p className="text-xs text-muted-foreground">
                  ScoreModel 已接（物化写入关系表路径）
                </p>
              ) : quickOpen.hasScoreModel === false ? (
                <p className="text-xs text-muted-foreground">
                  ScoreModel 未接（常见为旧快照或演示数据）
                </p>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              {result}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <AdminFooterNav />
    </div>
  );
}

export default function RunRankingPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-none p-6 text-sm text-muted-foreground">
          加载表单…
        </div>
      }
    >
      <RunRankingForm />
    </Suspense>
  );
}
