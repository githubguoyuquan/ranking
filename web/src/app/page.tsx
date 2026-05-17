import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getApiBase } from "@/lib/api";
import Link from "next/link";

type FetchOk<T> = { ok: true; data: T };
type FetchErr = { ok: false; error: string; httpStatus?: number };
type FetchResult<T> = FetchOk<T> | FetchErr;

async function fetchJson<T>(path: string): Promise<FetchResult<T>> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: text.trim() || `HTTP ${res.status}`,
        httpStatus: res.status,
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      return { ok: false, error: `非 JSON：${text.slice(0, 240)}` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "无法连接 API",
    };
  }
}

function optionalServiceBadge(args: { ok: boolean; detail?: string }) {
  if (args.ok) return <Badge>正常</Badge>;
  const d = args.detail ?? "";
  if (d.includes("not set")) {
    return <Badge variant="secondary">未配置</Badge>;
  }
  return <Badge variant="destructive">异常</Badge>;
}

export default async function HomePage() {
  const [apiRes, esRes, chRes] = await Promise.all([
    fetchJson<{ status?: string }>("/health"),
    fetchJson<{ ok: boolean; clusterName?: string; detail?: string }>(
      "/v1/search/health",
    ),
    fetchJson<{ ok: boolean; detail?: string }>(
      "/v1/analytics/clickhouse/health",
    ),
  ]);

  const apiOk =
    apiRes.ok && apiRes.data.status === "ok";
  const apiBody = apiRes.ok ? apiRes.data : null;
  const apiErr = !apiRes.ok ? apiRes.error : null;

  const es = esRes.ok ? esRes.data : null;
  const esErr = !esRes.ok ? esRes.error : null;

  const ch = chRes.ok ? chRes.data : null;
  const chErr = !chRes.ok ? chRes.error : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          对接本地 Nest API。请先启动后端（默认{" "}
          <code className="rounded bg-muted px-1">3000</code>
          ）与本站（{" "}
          <code className="rounded bg-muted px-1">3001</code>
          ）。下方并行探活可选依赖（未装 Docker 或未配环境变量时显示「未配置」属预期）。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">API</CardTitle>
              <Badge variant={apiOk ? "default" : "destructive"}>
                {apiOk ? "在线" : "离线 / 错误"}
              </Badge>
            </div>
            <CardDescription>
              <code className="text-xs">GET /health</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {apiErr ? (
              <p className="text-destructive">{apiErr}</p>
            ) : (
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(apiBody, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Elasticsearch</CardTitle>
              {optionalServiceBadge({
                ok: es?.ok === true,
                detail: es?.detail,
              })}
            </div>
            <CardDescription>
              <code className="text-xs">GET /v1/search/health</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {esErr ? (
              <p className="text-destructive">{esErr}</p>
            ) : (
              <>
                {es?.ok ? (
                  <p className="text-muted-foreground">
                    {es.clusterName ? `集群：${es.clusterName}` : "集群可达"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {es?.detail ?? "不可用"}
                  </p>
                )}
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(es, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">ClickHouse</CardTitle>
              {optionalServiceBadge({
                ok: ch?.ok === true,
                detail: ch?.detail,
              })}
            </div>
            <CardDescription>
              <code className="text-xs">GET /v1/analytics/clickhouse/health</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {chErr ? (
              <p className="text-destructive">{chErr}</p>
            ) : (
              <>
                {!ch?.ok ? (
                  <p className="text-muted-foreground">
                    {ch?.detail ?? "不可用"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">SELECT 1 通过</p>
                )}
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(ch, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快速入口</CardTitle>
          <CardDescription>种子与排行、搜索与运维常用页</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/seed"
          >
            演示数据（POST /admin/seed-demo）
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/rankings/run"
          >
            运行排行（POST /v1/rankings/run）
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/topics"
          >
            话题版本查询
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/search"
          >
            聚合搜索（实体 + 爬取 URL）
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/reindex"
          >
            索引维护（POST /admin/reindex-*）
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/entities"
          >
            实体管理
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/crawl"
          >
            爬虫任务（含异步轮询）
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/outbox"
          >
            Outbox 排查
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/snapshots/1"
          >
            示例：打开 snapshot id=1
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
