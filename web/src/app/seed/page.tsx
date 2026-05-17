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
import { getApiBase } from "@/lib/api";
import Link from "next/link";
import { useState } from "react";

export default function SeedPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  async function runSeed() {
    setLoading(true);
    setResult("");
    try {
      const res = await fetch(`${getApiBase()}/admin/seed-demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      let formatted: string;
      try {
        const j = JSON.parse(text) as unknown;
        formatted = JSON.stringify(j, null, 2);
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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">演示数据</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          调用后端 <code className="rounded bg-muted px-1">POST /admin/seed-demo</code>
          ，写入示例话题与多次快照。
        </p>
      </div>

      <Alert>
        <AlertTitle>开发提示</AlertTitle>
        <AlertDescription>
          会重复创建实体；仅适合本地清库后演示。生产请改用受控导入接口。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">执行</CardTitle>
          <CardDescription>成功后在下方 JSON 中取 snapshot id，打开快照页</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button disabled={loading} onClick={() => void runSeed()}>
            {loading ? "请求中…" : "写入演示数据"}
          </Button>
          {result ? (
            <pre className="max-h-[480px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              {result}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          ← 返回概览
        </Link>
      </p>
    </div>
  );
}
