"use client";

import { useCallback, useState } from "react";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { AdminPage } from "@/components/admin-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiUrl } from "@/lib/api";
import { BACKEND_ADMIN } from "@/lib/backend-api-paths";

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}

async function postJson(path: string, body?: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...apiHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export default function ScalePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [statusJson, setStatusJson] = useState<string | null>(null);

  const apply = useCallback(async (label: string, path: string, body?: unknown) => {
    setStatus(`${label}…`);
    const { ok, status: http, text } = await postJson(path, body);
    setStatusJson(text);
    setStatus(ok ? `${label} done` : `${label} HTTP ${http}`);
  }, []);

  const loadStatus = useCallback(async () => {
    setStatus("loading…");
    const res = await fetch(apiUrl("/admin/scale/status"), { headers: apiHeaders() });
    const text = await res.text();
    setStatusJson(text);
    setStatus(res.ok ? "ok" : `HTTP ${res.status}`);
  }, []);

  return (
    <AdminPage
      title="规模与运维"
      description="托管 ES ILM、Qdrant/ES 压测、CH MV 健康、PG 分区与写别名 rollover。"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">探测</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void loadStatus()}>
            拉取 status
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void apply("规模验证套件", BACKEND_ADMIN.scaleValidate, {})}
          >
            POST validate（ES+Qdrant+CH）
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Elasticsearch ILM</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void apply("ensure templates", "/admin/scale/elasticsearch/ensure-templates")}
          >
            ensure templates
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void apply("ensure ILM", "/admin/scale/elasticsearch/ensure-ilm")}
          >
            ensure ILM
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void apply("bootstrap ILM indices", "/admin/scale/elasticsearch/bootstrap-ilm-indices")}
          >
            bootstrap ILM indices
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void apply("bootstrap aliases", "/admin/scale/elasticsearch/bootstrap-aliases")}
          >
            bootstrap aliases (legacy)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              setStatus("ILM status…");
              const res = await fetch(apiUrl("/admin/scale/elasticsearch/ilm-status"), {
                headers: apiHeaders(),
              });
              const text = await res.text();
              setStatusJson(text);
              setStatus(res.ok ? "ILM status ok" : `HTTP ${res.status}`);
            }}
          >
            GET ilm-status
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void apply("ES benchmark", "/admin/scale/elasticsearch/benchmark", {
                query: "rank",
                iterations: 20,
              })
            }
          >
            ES search benchmark
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qdrant / Postgres</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void apply("Qdrant benchmark", "/admin/scale/qdrant/benchmark", {
                query: "rank",
                iterations: 30,
                limit: 10,
              })
            }
          >
            Qdrant benchmark
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void apply("PG partitions", "/admin/scale/postgres/ensure-partitions", {
                table: "RankingItemHistory",
                monthsAhead: 3,
              })
            }
          >
            ensure PG partitions
          </Button>
        </CardContent>
      </Card>

      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {statusJson ? (
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
          {statusJson}
        </pre>
      ) : null}

      <AdminFooterNav className="border-t border-border pt-6" />
    </AdminPage>
  );
}
