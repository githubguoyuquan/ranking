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
import {
  adminReindexCrawlDocsUrl,
  adminReindexEntitiesUrl,
} from "@/lib/backend-api-urls";
import { BACKEND_ADMIN } from "@/lib/backend-api-paths";
import { nestSearchHealthUrl } from "@/lib/nest-api-urls";
import { ADMIN_HREF } from "@/lib/admin-web-paths";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { useState } from "react";

export default function ReindexPage() {
  const { abs } = useAdminAppUrl();
  const [entitiesOut, setEntitiesOut] = useState("");
  const [crawlOut, setCrawlOut] = useState("");
  const [busyE, setBusyE] = useState(false);
  const [busyC, setBusyC] = useState(false);

  async function reindexEntities() {
    setBusyE(true);
    setEntitiesOut("");
    try {
      const res = await fetch(adminReindexEntitiesUrl(), {
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
      const res = await fetch(adminReindexCrawlDocsUrl(), {
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
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">索引维护</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          需配置 <code className="rounded bg-muted px-1 text-xs">ELASTICSEARCH_NODE</code>
          。全量灌库，数据量大时可能较慢。
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyTextButton
            text={abs(ADMIN_HREF.reindex)}
            idleLabel="复制本页链接"
            className="h-6"
          />
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">实体</CardTitle>
          <CardDescription>POST {BACKEND_ADMIN.reindexEntities}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <CopyTextButton
              text={adminReindexEntitiesUrl()}
              idleLabel="复制 POST URL"
              className="h-6"
            />
            <span className="text-muted-foreground/90">（需 POST + JSON body，常为 `{}`）</span>
          </p>
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
          <CardDescription>POST {BACKEND_ADMIN.reindexCrawlDocs}（仅 status=fetched）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <CopyTextButton
              text={adminReindexCrawlDocsUrl()}
              idleLabel="复制 POST URL"
              className="h-6"
            />
            <span className="text-muted-foreground/90">（需 POST + JSON body，常为 `{}`）</span>
          </p>
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

      <AdminFooterNav
        className="text-muted-foreground"
        leading={
          <>
            <a
              href={nestSearchHealthUrl()}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              ES health（JSON）
            </a>
            <CopyTextButton
              text={nestSearchHealthUrl()}
              idleLabel="复制 ES health URL"
              className="h-6"
            />
          </>
        }
      />
    </div>
  );
}
