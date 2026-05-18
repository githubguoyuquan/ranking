"use client";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
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
  CRAWL_SOURCE_NAME_INPUT_MAX_LEN,
  CRAWL_SOURCES_LIST_LIMIT_DEFAULT,
  CRAWL_SOURCE_URLS_PREVIEW_LIMIT,
  CRAWL_TRUST_TIER_INPUT_MAX_LEN,
  HTTP_URL_INPUT_MAX_LEN,
} from "@/lib/admin-input-limits";
import {
  DECIMAL_BIGINT_ID_MAX_DIGITS,
  isDecimalBigIntIdString,
  validateOptionalDecimalBigIntId,
} from "@/lib/decimal-id";
import {
  NEST_V1,
  NEST_V1_DOC,
  nestV1CrawlTaskPath,
} from "@/lib/nest-api-paths";
import {
  nestCrawlCheckpointUrl,
  nestCrawlSourcesListUrl,
  nestCrawlSourcesUrl,
  nestCrawlSourceUrlsUrl,
  nestCrawlTasksListUrl,
  nestCrawlTaskUrl,
  nestCrawlTasksUrl,
  nestCrawlUrlsRegisterUrl,
} from "@/lib/nest-api-urls";
import { unifiedSearchAdminPathFromSourceId } from "@/lib/unified-search-admin-path";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

const TRUST_TIER_MIN = 1;
const TRUST_TIER_MAX = 5;

function parseOptionalTrustTier(raw: string) {
  const t = raw.trim();
  if (t === "")
    return { ok: true as const, value: undefined as number | undefined };
  const n = Number(t);
  if (!Number.isInteger(n) || n < TRUST_TIER_MIN || n > TRUST_TIER_MAX) {
    return {
      ok: false as const,
      message: `trustTier 须为 ${TRUST_TIER_MIN}–${TRUST_TIER_MAX} 的整数，或留空不传`,
    };
  }
  return { ok: true as const, value: n };
}

type SourceRow = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  trustTier?: number;
};

function parseSources(text: string): SourceRow[] {
  try {
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return [];
    const rows: SourceRow[] = [];
    for (const x of arr) {
      if (typeof x !== "object" || x === null) continue;
      const o = x as Record<string, unknown>;
      if (o.id == null) continue;
      rows.push({
        id: String(o.id),
        name: o.name != null ? String(o.name) : "",
        kind: o.kind != null ? String(o.kind) : "",
        baseUrl: o.baseUrl != null ? String(o.baseUrl) : "",
        trustTier:
          typeof o.trustTier === "number" ? o.trustTier : undefined,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export default function CrawlAdminPage() {
  const { abs } = useAdminAppUrl();
  const [name, setName] = useState("Playwright 源");
  const [baseUrl, setBaseUrl] = useState("https://example.com");
  const [kind, setKind] = useState<"demo" | "http-fetch" | "http-playwright">(
    "http-fetch",
  );
  const [trustTierInput, setTrustTierInput] = useState("");
  const [topicIdInput, setTopicIdInput] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [seedUrl, setSeedUrl] = useState("https://example.com/");
  const [crawlAsync, setCrawlAsync] = useState(false);
  const [out, setOut] = useState("");
  const [listOut, setListOut] = useState("");
  const [listVersion, setListVersion] = useState(0);
  const [taskBusy, setTaskBusy] = useState(false);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [checkpointCrawlerName, setCheckpointCrawlerName] = useState("source:1");
  const [lastAsyncCrawlTaskId, setLastAsyncCrawlTaskId] = useState("");

  const sourcesListApiUrl = useMemo(
    () => nestCrawlSourcesListUrl(CRAWL_SOURCES_LIST_LIMIT_DEFAULT),
    [],
  );

  const urlsForSourceApiUrl = useMemo(() => {
    const id = sourceId.trim();
    if (!id) return "";
    return nestCrawlSourceUrlsUrl(id, CRAWL_SOURCE_URLS_PREVIEW_LIMIT);
  }, [sourceId]);

  const crawlCheckpointGetUrl = useMemo(() => {
    const t = checkpointCrawlerName.trim();
    if (!t) return "";
    return nestCrawlCheckpointUrl(t);
  }, [checkpointCrawlerName]);

  const crawlTasksListAllUrl = useMemo(() => nestCrawlTasksListUrl(30), []);

  const crawlTasksListForSourceUrl = useMemo(() => {
    const id = sourceId.trim();
    if (!id || !isDecimalBigIntIdString(id)) return "";
    return nestCrawlTasksListUrl(30, id);
  }, [sourceId]);

  const refreshSources = useCallback(async () => {
    try {
      const res = await fetch(
        nestCrawlSourcesListUrl(CRAWL_SOURCES_LIST_LIMIT_DEFAULT),
        { cache: "no-store" },
      );
      const text = await res.text();
      if (!res.ok) {
        setSources([]);
        return;
      }
      setSources(parseSources(text));
    } catch {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  useEffect(() => {
    if (sources.length === 0) return;
    setSourceId((s) => (s.trim() ? s : sources[0].id));
  }, [sources]);

  async function createSource() {
    setOut("");
    const nm = name.trim();
    const bu = baseUrl.trim();
    if (!nm || !bu) {
      setOut("请填写 name 与 baseUrl。");
      return;
    }
    const tt = parseOptionalTrustTier(trustTierInput);
    if (!tt.ok) {
      setOut(tt.message);
      return;
    }
    const tid = validateOptionalDecimalBigIntId(topicIdInput, "topicId");
    if (!tid.ok) {
      setOut(tid.message);
      return;
    }
    try {
      const res = await fetch(nestCrawlSourcesUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nm,
          baseUrl: bu,
          kind,
          ...(tt.value != null ? { trustTier: tt.value } : {}),
          ...(tid.value != null ? { topicId: tid.value } : {}),
        }),
      });
      const text = await res.text();
      setOut(
        res.ok
          ? formatMaybeJson(text)
          : `HTTP ${res.status}\n${formatMaybeJson(text)}`,
      );
      if (res.ok) {
        try {
          const j = JSON.parse(text) as { id?: unknown };
          if (j.id != null) setSourceId(String(j.id));
        } catch {
          /* ignore */
        }
        void refreshSources();
      }
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
    }
  }

  async function runTask() {
    const sid = sourceId.trim();
    if (!sid) {
      setOut("请先填写 sourceId，或在上方数据源表点击「选用」。");
      return;
    }
    if (!isDecimalBigIntIdString(sid)) {
      setOut(
        `sourceId 须为十进制 Source 主键（至多 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位数字），与后端 BigInt 解析一致。`,
      );
      return;
    }
    const seed = seedUrl.trim();
    if (!seed) {
      setOut("请填写 seedUrl。");
      return;
    }
    setOut("");
    setTaskBusy(true);
    setLastAsyncCrawlTaskId("");
    try {
      const res = await fetch(nestCrawlTasksUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: sid,
          seedUrls: [seed],
          async: crawlAsync,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setOut(`HTTP ${res.status}\n${formatMaybeJson(text)}`);
        return;
      }

      if (!crawlAsync) {
        setOut(formatMaybeJson(text));
        setListVersion((v) => v + 1);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        setOut(text);
        return;
      }
      if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) {
        setOut(formatMaybeJson(text));
        return;
      }
      const taskId = String((parsed as { id: unknown }).id);
      if (!isDecimalBigIntIdString(taskId)) {
        setOut(
          `异步响应中的任务 id 非预期格式（须为十进制，至多 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位）：${taskId}\n${formatMaybeJson(text)}`,
        );
        return;
      }
      setLastAsyncCrawlTaskId(taskId);
      const lines: string[] = [
        `异步任务已创建 id=${taskId}，轮询 GET ${nestV1CrawlTaskPath(taskId)} …`,
      ];

      const terminal = new Set(["completed", "failed"]);
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const poll = await fetch(nestCrawlTaskUrl(taskId), {
          cache: "no-store",
        });
        const body = await poll.text();
        if (!poll.ok) {
          lines.push(`轮询 HTTP ${poll.status}: ${body}`);
          break;
        }
        let task: { status?: string };
        try {
          task = JSON.parse(body) as { status?: string };
        } catch {
          lines.push(`轮询响应非 JSON：${body.slice(0, 200)}`);
          break;
        }
        const st = task.status ?? "";
        lines.push(`[${i + 1}s] status=${st}`);
        if (terminal.has(st)) {
          lines.push(formatMaybeJson(body));
          break;
        }
      }
      setOut(lines.join("\n"));
      setListVersion((v) => v + 1);
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskBusy(false);
    }
  }

  useEffect(() => {
    const id = sourceId.trim();
    if (!id) {
      setListOut("");
      return;
    }
    if (!isDecimalBigIntIdString(id)) {
      setListOut(
        `sourceId 格式无效（须为十进制，至多 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位），无法请求 urls。`,
      );
      return;
    }
    void (async () => {
      try {
        const res = await fetch(
          nestCrawlSourceUrlsUrl(id, CRAWL_SOURCE_URLS_PREVIEW_LIMIT),
          { cache: "no-store" },
        );
        const text = await res.text();
        if (res.status === 404) {
          setListOut("未找到该 Source（404）。请确认 id 是否正确，或在上表点「选用」。");
          return;
        }
        if (!res.ok) {
          setListOut(`HTTP ${res.status}\n${formatMaybeJson(text)}`);
          return;
        }
        setListOut(text);
      } catch {
        setListOut("");
      }
    })();
  }, [sourceId, listVersion]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">爬虫</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          创建 Source、跑爬取任务（同步或 **BullMQ 异步** + 轮询
          <code className="rounded bg-muted px-1 text-xs">GET {NEST_V1_DOC.crawlTask}</code>
          ）、查看最近 CrawledUrl。Playwright 需安装依赖并在服务端执行{" "}
          <code className="rounded bg-muted px-1 text-xs">npx playwright install chromium</code>。
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyTextButton
            text={abs(ADMIN_HREF.crawl)}
            idleLabel="复制本页链接"
            className="h-6"
          />
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            <code className="rounded bg-muted px-1">POST {NEST_V1.crawlUrls}</code>（
            注册单条 URL，需 JSON body）—{" "}
          </span>
          <CopyTextButton
            text={nestCrawlUrlsRegisterUrl()}
            idleLabel="复制 endpoint"
            className="h-6"
          />
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.crawlCheckpoint}</code>
          <Label htmlFor="crawl-checkpoint-name" className="sr-only">
            crawlerName
          </Label>
          <Input
            id="crawl-checkpoint-name"
            className="h-8 max-w-[14rem] font-mono text-xs"
            placeholder="crawlerName"
            value={checkpointCrawlerName}
            onChange={(e) => setCheckpointCrawlerName(e.target.value)}
          />
          {crawlCheckpointGetUrl ? (
            <>
              <a
                href={crawlCheckpointGetUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                新标签打开
              </a>
              <CopyTextButton
                text={crawlCheckpointGetUrl}
                idleLabel="复制 GET URL"
                className="h-6"
              />
            </>
          ) : (
            <span className="text-muted-foreground/80">填写 crawlerName</span>
          )}
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">已有数据源</CardTitle>
            <CardDescription>
              <code className="text-xs">
                GET {NEST_V1.crawlSources}?limit={CRAWL_SOURCES_LIST_LIMIT_DEFAULT}
              </code>
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => void refreshSources()}
          >
            刷新列表
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <a
              href={sourcesListApiUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              新标签打开数据源列表（GET {NEST_V1.crawlSources}?limit=
              {CRAWL_SOURCES_LIST_LIMIT_DEFAULT}）
            </a>
            <CopyTextButton
              text={sourcesListApiUrl}
              idleLabel="复制列表 URL"
              className="h-6"
            />
          </p>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无数据源，或加载失败。请先新建或检查 API。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">id</th>
                    <th scope="col" className="px-3 py-2 font-medium">name</th>
                    <th scope="col" className="px-3 py-2 font-medium">kind</th>
                    <th scope="col" className="px-3 py-2 font-medium">tier</th>
                    <th scope="col" className="px-3 py-2 font-medium">baseUrl</th>
                    <th scope="col" className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-border/60 last:border-0"
                    >
                      <th
                        scope="row"
                        className="whitespace-nowrap px-3 py-1.5 font-mono text-xs font-normal"
                      >
                        {s.id}
                      </th>
                      <td className="px-3 py-1.5">{s.name}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                        {s.kind}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                        {s.trustTier ?? "—"}
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-1.5 text-xs text-muted-foreground">
                        {s.baseUrl}
                      </td>
                      <td className="space-x-2 px-3 py-1.5 text-right whitespace-nowrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          asChild
                        >
                          <Link
                            href={unifiedSearchAdminPathFromSourceId(s.id)}
                          >
                            搜索
                          </Link>
                        </Button>
                        <CopyTextButton
                          text={abs(unifiedSearchAdminPathFromSourceId(s.id))}
                          idleLabel="复制搜索页"
                          className="h-8 px-2 text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => setSourceId(s.id)}
                        >
                          选用
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新建数据源</CardTitle>
          <CardDescription>
            <code className="text-xs">http-playwright</code> 需{" "}
            <code className="text-xs">CRAWL_USE_PLAYWRIGHT=true</code>             或该 kind。可选 trustTier
            与 DTO 一致（{TRUST_TIER_MIN}–{TRUST_TIER_MAX}，留空则不传）、topicId（十进制 Topic
            主键，≤{DECIMAL_BIGINT_ID_MAX_DIGITS}
            位，留空则不传）。<code className="text-xs">name</code> 最多{" "}
            <code className="text-xs">{CRAWL_SOURCE_NAME_INPUT_MAX_LEN}</code> 字符；<code className="text-xs">baseUrl</code> / 下方 <code className="text-xs">seedUrl</code> 各最多{" "}
            <code className="text-xs">{HTTP_URL_INPUT_MAX_LEN}</code> 字符（运营台防御性上限）。name / baseUrl 框内{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-[10px]">Enter</kbd>{" "}
            可提交创建。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:col-span-2">
            <CopyTextButton
              text={nestCrawlSourcesUrl()}
              idleLabel="复制 POST URL"
              className="h-6"
            />
            <span className="text-muted-foreground/90">POST + JSON body 创建数据源</span>
          </p>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="crawl-new-name">name</Label>
            <Input
              id="crawl-new-name"
              maxLength={CRAWL_SOURCE_NAME_INPUT_MAX_LEN}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !name.trim() || !baseUrl.trim()) return;
                void createSource();
              }}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="crawl-new-baseUrl">baseUrl</Label>
            <Input
              id="crawl-new-baseUrl"
              maxLength={HTTP_URL_INPUT_MAX_LEN}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !name.trim() || !baseUrl.trim()) return;
                void createSource();
              }}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="crawl-new-topicId">topicId（可选）</Label>
            <Input
              id="crawl-new-topicId"
              inputMode="numeric"
              value={topicIdInput}
              maxLength={DECIMAL_BIGINT_ID_MAX_DIGITS}
              onChange={(e) => setTopicIdInput(e.target.value)}
              placeholder="十进制 Topic 主键"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !name.trim() || !baseUrl.trim()) return;
                void createSource();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="crawl-new-kind">kind</Label>
            <select
              id="crawl-new-kind"
              className={selectClass}
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as typeof kind)
              }
            >
              <option value="demo">demo（桩）</option>
              <option value="http-fetch">http-fetch</option>
              <option value="http-playwright">http-playwright</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="crawl-new-trustTier">trustTier（可选）</Label>
            <Input
              id="crawl-new-trustTier"
              inputMode="numeric"
              maxLength={CRAWL_TRUST_TIER_INPUT_MAX_LEN}
              value={trustTierInput}
              onChange={(e) => setTrustTierInput(e.target.value)}
              placeholder={`${TRUST_TIER_MIN}–${TRUST_TIER_MAX}，留空默认`}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !name.trim() || !baseUrl.trim()) return;
                void createSource();
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              disabled={!name.trim() || !baseUrl.trim()}
              onClick={() => void createSource()}
            >
              POST {NEST_V1.crawlSources}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">爬取任务</CardTitle>
          <CardDescription>
            勾选「异步」时经 BullMQ 执行，页面约每秒轮询直至{" "}
            <code className="text-xs">completed</code> /{" "}
            <code className="text-xs">failed</code>（最长约 2 分钟）。sourceId 须为十进制
            Source 主键（至多 {DECIMAL_BIGINT_ID_MAX_DIGITS}{" "}
            位）。<code className="rounded bg-muted px-1 text-xs">GET</code>{" "}
            <code className="rounded bg-muted px-1 text-xs">
              /v1/crawl/tasks
            </code>{" "}
            可按 <code className="text-xs">limit</code>、
            <code className="text-xs">sourceId</code> 列出近期任务。在 sourceId 或 seedUrl 按{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-[10px]">Enter</kbd>{" "}
            可提交任务。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:col-span-2">
            <CopyTextButton
              text={nestCrawlTasksUrl()}
              idleLabel="复制 POST URL"
              className="h-6"
            />
            <span className="text-muted-foreground/90">POST + JSON body 提交任务</span>
            <span className="text-muted-foreground/40" aria-hidden>
              ·
            </span>
            <a
              href={crawlTasksListAllUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              GET 任务列表（limit=30）
            </a>
            <CopyTextButton
              text={crawlTasksListAllUrl}
              idleLabel="复制任务列表 URL（全量）"
              className="h-6"
            />
            {crawlTasksListForSourceUrl ? (
              <>
                <a
                  href={crawlTasksListForSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  GET 任务列表（当前 source）
                </a>
                <CopyTextButton
                  text={crawlTasksListForSourceUrl}
                  idleLabel="复制任务列表 URL（当前 source）"
                  className="h-6"
                />
              </>
            ) : null}
          </p>
          <div className="space-y-2">
            <Label htmlFor="crawl-task-sourceId">sourceId</Label>
            <Input
              id="crawl-task-sourceId"
              inputMode="numeric"
              maxLength={DECIMAL_BIGINT_ID_MAX_DIGITS}
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key !== "Enter" ||
                  taskBusy ||
                  !sourceId.trim() ||
                  !seedUrl.trim() ||
                  !isDecimalBigIntIdString(sourceId.trim())
                )
                  return;
                void runTask();
              }}
            />
          </div>
          <div className="flex items-center gap-2 pt-8">
            <input
              id="crawl-async"
              type="checkbox"
              checked={crawlAsync}
              onChange={(e) => setCrawlAsync(e.target.checked)}
              className="h-4 w-4 rounded border border-input"
            />
            <Label htmlFor="crawl-async" className="font-normal cursor-pointer">
              异步（async: true）
            </Label>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="crawl-task-seedUrl">seedUrl</Label>
            <Input
              id="crawl-task-seedUrl"
              maxLength={HTTP_URL_INPUT_MAX_LEN}
              value={seedUrl}
              onChange={(e) => setSeedUrl(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key !== "Enter" ||
                  taskBusy ||
                  !sourceId.trim() ||
                  !seedUrl.trim() ||
                  !isDecimalBigIntIdString(sourceId.trim())
                )
                  return;
                void runTask();
              }}
            />
          </div>
          <Button
            type="button"
            disabled={
              taskBusy ||
              !sourceId.trim() ||
              !seedUrl.trim() ||
              !isDecimalBigIntIdString(sourceId.trim())
            }
            onClick={() => void runTask()}
          >
            {taskBusy
              ? crawlAsync
                ? "轮询中…"
                : "执行中…"
              : `POST ${NEST_V1.crawlTasks}（async: ${crawlAsync}）`}
          </Button>
          {lastAsyncCrawlTaskId ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:col-span-2">
              <span className="text-muted-foreground/90">最近异步任务</span>
              <a
                href={nestCrawlTaskUrl(lastAsyncCrawlTaskId)}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                GET 任务 JSON
              </a>
              <CopyTextButton
                text={nestCrawlTaskUrl(lastAsyncCrawlTaskId)}
                idleLabel="复制任务 URL"
                className="h-6"
              />
              <CopyTextButton
                text={lastAsyncCrawlTaskId}
                idleLabel="复制 taskId"
                className="h-6"
              />
            </p>
          ) : null}
        </CardContent>
      </Card>

      {out ? (
        <pre className="overflow-x-auto rounded-lg border border-border p-3 text-xs">
          {out}
        </pre>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近 URL</CardTitle>
          <CardDescription>
            GET {NEST_V1.crawlSources}/
            {sourceId.trim() || "…"}/urls
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {urlsForSourceApiUrl ? (
              <>
                <a
                  href={urlsForSourceApiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  新标签打开当前 source 的 urls（JSON）
                </a>
                <CopyTextButton
                  text={urlsForSourceApiUrl}
                  idleLabel="复制 urls URL"
                  className="h-6"
                />
              </>
            ) : (
              <span>加载数据源后会自动填充 sourceId；亦可手动填写后再打开链接。</span>
            )}
          </p>
          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap">
            {listOut || "—"}
          </pre>
        </CardContent>
      </Card>

      <AdminFooterNav className="text-muted-foreground" />
    </div>
  );
}
