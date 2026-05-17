"use client";

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
import { useEffect, useState } from "react";

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

export default function CrawlAdminPage() {
  const [name, setName] = useState("Playwright 源");
  const [baseUrl, setBaseUrl] = useState("https://example.com");
  const [kind, setKind] = useState<"demo" | "http-fetch" | "http-playwright">(
    "http-fetch",
  );
  const [sourceId, setSourceId] = useState("1");
  const [seedUrl, setSeedUrl] = useState("https://example.com/");
  const [crawlAsync, setCrawlAsync] = useState(false);
  const [out, setOut] = useState("");
  const [listOut, setListOut] = useState("");
  const [listVersion, setListVersion] = useState(0);
  const [taskBusy, setTaskBusy] = useState(false);

  async function createSource() {
    setOut("");
    try {
      const res = await fetch(`${getApiBase()}/v1/crawl/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseUrl, kind }),
      });
      setOut(`${await res.text()}`);
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
    }
  }

  async function runTask() {
    setOut("");
    setTaskBusy(true);
    try {
      const res = await fetch(`${getApiBase()}/v1/crawl/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId,
          seedUrls: [seedUrl],
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
      const lines: string[] = [
        `异步任务已创建 id=${taskId}，轮询 GET /v1/crawl/tasks/${taskId} …`,
      ];

      const terminal = new Set(["completed", "failed"]);
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const poll = await fetch(
          `${getApiBase()}/v1/crawl/tasks/${encodeURIComponent(taskId)}`,
          { cache: "no-store" },
        );
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
    void (async () => {
      try {
        const res = await fetch(
          `${getApiBase()}/v1/crawl/sources/${encodeURIComponent(sourceId)}/urls?limit=5`,
          { cache: "no-store" },
        );
        setListOut(await res.text());
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
          <code className="rounded bg-muted px-1 text-xs">GET /v1/crawl/tasks/:id</code>
          ）、查看最近 CrawledUrl。Playwright 需安装依赖并在服务端执行{" "}
          <code className="rounded bg-muted px-1 text-xs">npx playwright install chromium</code>。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新建数据源</CardTitle>
          <CardDescription>
            <code className="text-xs">http-playwright</code> 需{" "}
            <code className="text-xs">CRAWL_USE_PLAYWRIGHT=true</code> 或该 kind。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>baseUrl</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>kind</Label>
            <select
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
          <div className="flex items-end">
            <Button type="button" onClick={() => void createSource()}>
              POST /v1/crawl/sources
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
            <code className="text-xs">failed</code>（最长约 2 分钟）。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>sourceId</Label>
            <Input value={sourceId} onChange={(e) => setSourceId(e.target.value)} />
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
            <Label>seedUrl</Label>
            <Input value={seedUrl} onChange={(e) => setSeedUrl(e.target.value)} />
          </div>
          <Button
            type="button"
            disabled={taskBusy}
            onClick={() => void runTask()}
          >
            {taskBusy
              ? crawlAsync
                ? "轮询中…"
                : "执行中…"
              : `POST /v1/crawl/tasks（async: ${crawlAsync}）`}
          </Button>
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
            GET /v1/crawl/sources/{sourceId}/urls
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap">
            {listOut || "—"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
