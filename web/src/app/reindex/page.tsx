"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getApiBase } from "@/lib/api";
import { useState } from "react";

export default function ReindexPage() {
  const [entitiesOut, setEntitiesOut] = useState("");
  const [crawlOut, setCrawlOut] = useState("");
  const [busyE, setBusyE] = useState(false);
  const [busyC, setBusyC] = useState(false);

  async function reindexEntities() {
    setBusyE(true);
    setEntitiesOut("");
    try {
      const res = await fetch(`${getApiBase()}/admin/reindex-entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const text = await res.text();
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        formatted = text;
      }
      setEntitiesOut(`${res.ok ? "" : `HTTP ${res.status}\n`}${formatted}`);
    } catch (e) {
      setEntitiesOut(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyE(false);
    }
  }

  async function reindexCrawl() {
    setBusyC(true);
    setCrawlOut("");
    try {
      const res = await fetch(`${getApiBase()}/admin/reindex-crawl-docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const text = await res.text();
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        formatted = text;
      }
      setCrawlOut(`${res.ok ? "" : `HTTP ${res.status}\n`}${formatted}`);
    } catch (e) {
      setCrawlOut(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyC(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">索引维护</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          需配置 <code className="rounded bg-muted px-1 text-xs">ELASTICSEARCH_NODE</code>
          。全量灌库，数据量大时可能较慢。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">实体</CardTitle>
          <CardDescription>POST /admin/reindex-entities</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button type="button" disabled={busyE} onClick={() => void reindexEntities()}>
            {busyE ? "执行中…" : "全量重灌 ranking_entities"}
          </Button>
          {entitiesOut ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {entitiesOut}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">爬取文档</CardTitle>
          <CardDescription>POST /admin/reindex-crawl-docs（仅 status=fetched）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button type="button" disabled={busyC} onClick={() => void reindexCrawl()}>
            {busyC ? "执行中…" : "全量重灌 ranking_crawled_urls"}
          </Button>
          {crawlOut ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {crawlOut}
            </pre>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
