"use client";

import { useCallback, useState } from "react";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiUrl } from "@/lib/api";

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}

export default function ScalePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [statusJson, setStatusJson] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatus("loading…");
    const res = await fetch(apiUrl("/admin/scale/status"), { headers: apiHeaders() });
    const text = await res.text();
    setStatusJson(text);
    setStatus(res.ok ? "ok" : `HTTP ${res.status}`);
  }, []);

  const ensurePartitions = useCallback(async () => {
    setStatus("partitions…");
    const res = await fetch(apiUrl("/admin/scale/postgres/ensure-partitions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiHeaders() },
      body: JSON.stringify({ table: "RankingItemHistory", monthsAhead: 3 }),
    });
    const text = await res.text();
    setStatusJson(text);
    setStatus(res.ok ? "partitions done" : `HTTP ${res.status}`);
  }, []);

  const bootstrapEs = useCallback(async () => {
    setStatus("ES bootstrap…");
    const res = await fetch(apiUrl("/admin/scale/elasticsearch/bootstrap-aliases"), {
      method: "POST",
      headers: apiHeaders(),
    });
    const text = await res.text();
    setStatusJson(text);
    setStatus(res.ok ? "ES bootstrap done" : `HTTP ${res.status}`);
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">规模与运维</h1>
      <p className="text-sm text-muted-foreground">
        Phase C：只读副本、PG 月分区、ES 写别名与 rollover、爬虫代理池与队列分片。
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">操作</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void loadStatus()}>
            拉取 status
          </Button>
          <Button type="button" variant="secondary" onClick={() => void ensurePartitions()}>
            ensure PG partitions
          </Button>
          <Button type="button" variant="secondary" onClick={() => void bootstrapEs()}>
            ES bootstrap aliases
          </Button>
        </CardContent>
      </Card>

      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {statusJson ? (
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
          {statusJson}
        </pre>
      ) : null}

      <AdminFooterNav />
    </div>
  );
}
