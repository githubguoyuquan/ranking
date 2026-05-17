import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getApiBase } from "@/lib/api";
import Link from "next/link";

export default async function HomePage() {
  let health: { status?: string } | null = null;
  let healthError: string | null = null;
  try {
    const res = await fetch(`${getApiBase()}/health`, { cache: "no-store" });
    health = await res.json();
    if (!res.ok) healthError = `HTTP ${res.status}`;
  } catch (e) {
    healthError = e instanceof Error ? e.message : "无法连接 API";
  }

  const apiOk = health?.status === "ok" && !healthError;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          对接本地 Nest API，深色主题。请先启动后端（默认{" "}
          <code className="rounded bg-muted px-1">3000</code>
          ）与本站（{" "}
          <code className="rounded bg-muted px-1">3001</code>）。
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">API 状态</CardTitle>
            <Badge variant={apiOk ? "default" : "destructive"}>
              {apiOk ? "在线" : "异常 / 离线"}
            </Badge>
          </div>
          <CardDescription>
            GET <code className="text-xs">{getApiBase()}/health</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {healthError ? (
            <p className="text-destructive">{healthError}</p>
          ) : (
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(health, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快速入口</CardTitle>
          <CardDescription>按顺序：种子数据 → 运行排行 → 看快照</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/seed"
          >
            1. 演示数据（POST /admin/seed-demo）
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/rankings/run"
          >
            2. 运行排行（POST /v1/rankings/run）
          </Link>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/topics"
          >
            3. 话题版本查询
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
