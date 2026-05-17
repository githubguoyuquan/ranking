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
import Link from "next/link";
import { useState } from "react";

export default function TopicsPage() {
  const [slug, setSlug] = useState("global-female-singers");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  async function load() {
    setLoading(true);
    setResult("");
    try {
      const res = await fetch(
        `${getApiBase()}/v1/topics/${encodeURIComponent(slug)}/versions`,
        { cache: "no-store" },
      );
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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">话题版本</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">GET /v1/topics/:slug/versions</code>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">查询</CardTitle>
          <CardDescription>演示数据默认 slug：global-female-singers</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="slug">slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
            <Button disabled={loading} onClick={() => void load()}>
              {loading ? "加载中…" : "加载"}
            </Button>
          </div>
          {result ? (
            <pre className="max-h-[480px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
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
