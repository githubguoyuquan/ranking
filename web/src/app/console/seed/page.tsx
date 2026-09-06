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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { adminSeedDemoUrl } from "@/lib/backend-api-urls";
import { BACKEND_ADMIN } from "@/lib/backend-api-paths";
import { TOPIC_SLUG_MAX_LEN } from "@/lib/admin-input-limits";
import {
  ADMIN_HREF,
  rankingsRunAdminPath,
  snapshotDetailAdminPath,
  snapshotsCompareAdminPath,
  topicsAdminPath,
} from "@/lib/admin-web-paths";
import Link from "next/link";
import { useState } from "react";

type SeedDemoResponse = {
  topicId?: string;
  topicVersionId?: string;
  snapshots?: Array<{ id?: string | number | bigint }>;
};

export default function SeedPage() {
  const { abs: appUrl } = useAdminAppUrl();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [slug, setSlug] = useState("");
  const [quickLinks, setQuickLinks] = useState<{
    topicVersionId?: string;
    snapshotIds: string[];
  } | null>(null);

  async function runSeed() {
    setLoading(true);
    setResult("");
    setQuickLinks(null);
    try {
      const body =
        slug.trim() === "" ? {} : { slug: slug.trim() };
      const res = await fetch(adminSeedDemoUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let formatted: string;
      try {
        const j = JSON.parse(text) as unknown;
        formatted = JSON.stringify(j, null, 2);
        if (res.ok) {
          const parsed = j as SeedDemoResponse;
          const ids =
            parsed.snapshots
              ?.map((s) =>
                s.id != null && s.id !== "" ? String(s.id) : null,
              )
              .filter((x): x is string => x != null) ?? [];
          setQuickLinks({
            topicVersionId:
              parsed.topicVersionId != null
                ? String(parsed.topicVersionId)
                : undefined,
            snapshotIds: ids,
          });
        }
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
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">演示数据</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          调用后端 <code className="rounded bg-muted px-1">POST {BACKEND_ADMIN.seedDemo}</code>
          ，写入示例话题与多次快照。
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyTextButton
            text={adminSeedDemoUrl()}
            idleLabel="复制 POST URL"
            className="h-6"
          />
          <span className="text-muted-foreground/90">body 可为 `{}` 或带 slug</span>
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyTextButton
            text={appUrl(ADMIN_HREF.seed)}
            idleLabel="复制本页链接"
            className="h-6"
          />
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
          <CardDescription>
            成功后在下方 JSON 中取快照 id；可选 slug，空则使用后端默认{" "}
            <code className="text-xs">global-female-singers</code>
            。slug 框内{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-xs">Enter</kbd>{" "}
            可提交。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="seed-slug">slug（可选）</Label>
            <Input
              id="seed-slug"
              maxLength={TOPIC_SLUG_MAX_LEN}
              placeholder="global-female-singers"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || loading) return;
                void runSeed();
              }}
            />
          </div>
          <Button disabled={loading} onClick={() => void runSeed()}>
            {loading ? "请求中…" : "写入演示数据"}
          </Button>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Link
              href={topicsAdminPath(slug.trim() || "global-female-singers")}
              className="text-primary underline-offset-4 hover:underline"
            >
              按当前 slug 打开话题热榜 →
            </Link>
            <CopyTextButton
              text={appUrl(topicsAdminPath(slug.trim() || "global-female-singers"))}
              idleLabel="复制话题页链接"
              className="h-6"
            />
          </p>

          {quickLinks &&
          (quickLinks.snapshotIds.length > 0 || quickLinks.topicVersionId) ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">快捷打开</span>
                {quickLinks.snapshotIds.length > 0 ? (
                  <CopyTextButton
                    text={quickLinks.snapshotIds.join(",")}
                    idleLabel="复制快照 ids"
                    className="h-6"
                  />
                ) : null}
                {quickLinks.topicVersionId ? (
                  <CopyTextButton
                    text={quickLinks.topicVersionId}
                    idleLabel="复制 topicVersionId"
                    className="h-6"
                  />
                ) : null}
                {quickLinks.snapshotIds.length > 0 ? (
                  <CopyTextButton
                    text={appUrl(snapshotDetailAdminPath(quickLinks.snapshotIds[0]))}
                    idleLabel="复制首张快照页链接"
                    className="h-6"
                  />
                ) : null}
                {quickLinks.snapshotIds.length >= 2 ? (
                  <CopyTextButton
                    text={appUrl(snapshotsCompareAdminPath(quickLinks.snapshotIds))}
                    idleLabel="复制对比页链接"
                    className="h-6"
                  />
                ) : null}
                {quickLinks.topicVersionId ? (
                  <CopyTextButton
                    text={appUrl(rankingsRunAdminPath(quickLinks.topicVersionId))}
                    idleLabel="复制跑榜页链接"
                    className="h-6"
                  />
                ) : null}
              </div>
              {quickLinks.snapshotIds.length > 0 ? (
                <ul className="mt-2 space-y-2 text-muted-foreground">
                  {quickLinks.snapshotIds.map((id) => (
                    <li key={id} className="flex flex-wrap items-center gap-x-2 text-sm">
                      <Link
                        href={snapshotDetailAdminPath(id)}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        快照 {id}
                      </Link>
                      <CopyTextButton
                        text={appUrl(snapshotDetailAdminPath(id))}
                        idleLabel="复制"
                        className="h-5 px-1.5 text-xs"
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
              {quickLinks.snapshotIds.length >= 2 ? (
                <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs">
                  <Link
                    href={snapshotsCompareAdminPath(quickLinks.snapshotIds)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    并列对比本批 {quickLinks.snapshotIds.length} 张快照 →
                  </Link>
                  <CopyTextButton
                    text={appUrl(snapshotsCompareAdminPath(quickLinks.snapshotIds))}
                    idleLabel="复制"
                    className="h-5 px-1.5 text-xs"
                  />
                </p>
              ) : null}
              {quickLinks.topicVersionId ? (
                <p
                  className={
                    quickLinks.snapshotIds.length > 0
                      ? "mt-3 text-xs text-muted-foreground"
                      : "mt-2 text-xs text-muted-foreground"
                  }
                >
                  topicVersionId{" "}
                  <code className="rounded bg-muted px-1">
                    {quickLinks.topicVersionId}
                  </code>
                  — 可在{" "}
                  <span className="inline-flex flex-wrap items-center gap-x-1">
                    <Link
                      href={rankingsRunAdminPath(quickLinks.topicVersionId)}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      运行排行
                    </Link>
                    <CopyTextButton
                      text={appUrl(rankingsRunAdminPath(quickLinks.topicVersionId))}
                      idleLabel="复制"
                      className="h-5 px-2 text-xs"
                    />
                  </span>{" "}
                  或{" "}
                  <span className="inline-flex flex-wrap items-center gap-x-1">
                    <Link
                      href={ADMIN_HREF.topics}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      话题版本
                    </Link>
                    <CopyTextButton
                      text={appUrl(ADMIN_HREF.topics)}
                      idleLabel="复制"
                      className="h-5 px-2 text-xs"
                    />
                  </span>{" "}
                  继续使用。
                </p>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <pre className="max-h-[480px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              {result}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <AdminFooterNav
        leading={
          <>
            {quickLinks?.snapshotIds?.[0] ? (
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <Link
                  href={snapshotDetailAdminPath(quickLinks.snapshotIds[0])}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  快照 #{quickLinks.snapshotIds[0]}（本批首张）
                </Link>
                <CopyTextButton
                  text={appUrl(snapshotDetailAdminPath(quickLinks.snapshotIds[0]))}
                  idleLabel="复制快照页链接"
                  className="h-6"
                />
              </span>
            ) : null}
            {quickLinks && quickLinks.snapshotIds.length >= 2 ? (
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <Link
                  href={snapshotsCompareAdminPath(quickLinks.snapshotIds)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  本批快照对比
                </Link>
                <CopyTextButton
                  text={appUrl(snapshotsCompareAdminPath(quickLinks.snapshotIds))}
                  idleLabel="复制对比页链接"
                  className="h-6"
                />
              </span>
            ) : null}
          </>
        }
      />
    </div>
  );
}
