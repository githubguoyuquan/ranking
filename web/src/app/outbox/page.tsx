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
import { useState } from "react";

export default function OutboxPage() {
  const [limit, setLimit] = useState("40");
  const [typeFilter, setTypeFilter] = useState("");
  const [pendingOnly, setPendingOnly] = useState(true);
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setOut("");
    try {
      const params = new URLSearchParams({ limit: limit.trim() || "40" });
      if (typeFilter.trim()) params.set("type", typeFilter.trim());
      if (pendingOnly) params.set("pendingOnly", "true");
      const res = await fetch(`${getApiBase()}/admin/outbox?${params}`, {
        cache: "no-store",
      });
      const text = await res.text();
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        formatted = text;
      }
      setOut(`${res.ok ? "" : `HTTP ${res.status}\n`}${formatted}`);
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Outbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          GET /admin/outbox — 只读排查（<code className="rounded bg-muted px-1 text-xs">pendingOnly</code>{" "}
          仅未发布）。生产请不要再暴露公网。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">查询</CardTitle>
          <CardDescription>
            可选 <code className="text-xs">type</code>：如{" "}
            <code className="text-xs">elasticsearch.entity.sync</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="limit">limit</Label>
              <Input
                id="limit"
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="type">type（可选）</Label>
              <Input
                id="type"
                placeholder="elasticsearch.entity.sync"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => setPendingOnly(e.target.checked)}
            />
            仅未发布（publishedAt 为空）
          </label>
          <Button type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "加载中…" : "加载"}
          </Button>
          {out ? (
            <pre className="max-h-[32rem] overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {out}
            </pre>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
