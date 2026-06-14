"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { AdminPage } from "@/components/admin-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_HREF, topicsAdminPath } from "@/lib/admin-web-paths";
import { NEST_V1_DOC } from "@/lib/nest-api-paths";
import { nestTopicVersionsCompareUrl, nestTopicVersionsCompareReportUrl, nestTopicVersionsUrl } from "@/lib/nest-api-urls";

type VersionRow = { id: string; version: string; effectiveFrom: string; frozen: boolean };

type CompareResult = {
  topic?: { slug: string; title: string };
  from?: { id: string; version: string };
  to?: { id: string; version: string };
  policyDiff?: {
    unchanged?: boolean;
    weightChanges?: Array<{ key: string; kind: string; from?: number; to?: number }>;
    entityIdsAdded?: string[];
    entityIdsRemoved?: string[];
    decayChanged?: boolean;
  };
  rankPreview?: {
    available?: boolean;
    reason?: string;
    movers?: Array<{
      entityId: string;
      canonicalName: string;
      fromRank: number | null;
      toRank: number | null;
      rankDelta: number | null;
    }>;
  } | null;
};

function VersionDiffPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [slug, setSlug] = useState(sp.get("slug")?.trim() ?? "global-female-singers");
  const [fromId, setFromId] = useState(sp.get("from")?.trim() ?? "");
  const [toId, setToId] = useState(sp.get("to")?.trim() ?? "");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [aiReport, setAiReport] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const loadVersions = useCallback(async (topicSlug: string) => {
    const res = await fetch(nestTopicVersionsUrl(topicSlug), { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new Error(`versions HTTP ${res.status}: ${text}`);
    const rows = JSON.parse(text) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      version: String(r.version),
      effectiveFrom: String(r.effectiveFrom),
      frozen: Boolean(r.frozen),
    }));
  }, []);

  useEffect(() => {
    const s = sp.get("slug")?.trim() || slug;
    let cancelled = false;
    (async () => {
      try {
        const v = await loadVersions(s);
        if (!cancelled) setVersions(v);
      } catch {
        if (!cancelled) setVersions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sp, slug, loadVersions]);

  const canCompare = fromId.trim() !== "" && toId.trim() !== "" && fromId !== toId;

  async function runCompare() {
    if (!canCompare) {
      setErr("请选择两个不同的 TopicVersion id");
      return;
    }
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      const res = await fetch(nestTopicVersionsCompareUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromTopicVersionId: fromId.trim(),
          toTopicVersionId: toId.trim(),
          includeRankPreview: true,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setErr(`HTTP ${res.status}\n${text}`);
        return;
      }
      setResult(JSON.parse(text) as CompareResult);
      const q = new URLSearchParams({ slug: slug.trim(), from: fromId.trim(), to: toId.trim() });
      router.replace(`${ADMIN_HREF.topicsVersionDiff}?${q.toString()}`, { scroll: false });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function generateAiReport() {
    if (!canCompare) return;
    setAiLoading(true);
    setAiReport("");
    try {
      const res = await fetch(nestTopicVersionsCompareReportUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromTopicVersionId: fromId.trim(),
          toTopicVersionId: toId.trim(),
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setErr(`AI 报告 HTTP ${res.status}\n${text}`);
        return;
      }
      const parsed = JSON.parse(text) as { report?: string };
      setAiReport(parsed.report ?? text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  }

  const diffSummary = useMemo(() => {
    const d = result?.policyDiff;
    if (!d) return "";
    if (d.unchanged) return "策略无变化";
    const parts: string[] = [];
    if (d.weightChanges?.length) parts.push(`${d.weightChanges.length} 项权重变更`);
    if (d.entityIdsAdded?.length) parts.push(`+${d.entityIdsAdded.length} 实体`);
    if (d.entityIdsRemoved?.length) parts.push(`-${d.entityIdsRemoved.length} 实体`);
    if (d.decayChanged) parts.push("decay 变更");
    return parts.join(" · ");
  }, [result]);

  return (
    <AdminPage
      title="话题版本 Diff"
      description={`对比 TopicVersion policy 与可选榜位预览。API：POST ${NEST_V1_DOC.topicVersionCompare}`}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">选择版本</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="slug">话题 slug</Label>
            <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="from">from TopicVersion id</Label>
            <Input id="from" value={fromId} onChange={(e) => setFromId(e.target.value)} list="tv-list" />
          </div>
          <div>
            <Label htmlFor="to">to TopicVersion id</Label>
            <Input id="to" value={toId} onChange={(e) => setToId(e.target.value)} list="tv-list" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" onClick={() => void runCompare()} disabled={loading || !canCompare}>
              {loading ? "对比中…" : "对比"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void generateAiReport()}
              disabled={aiLoading || !canCompare}
            >
              {aiLoading ? "生成中…" : "AI 报告"}
            </Button>
            <Link href={topicsAdminPath(slug)} className="text-sm text-primary underline-offset-4 hover:underline">
              话题页
            </Link>
          </div>
          <datalist id="tv-list">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.version} ({v.effectiveFrom.slice(0, 10)})
              </option>
            ))}
          </datalist>
        </CardContent>
      </Card>

      {result && (
        <>
          <p className="text-sm">
            {result.topic?.title} ({result.topic?.slug}) — {result.from?.version} → {result.to?.version}
            {diffSummary ? ` · ${diffSummary}` : ""}
          </p>

          {result.policyDiff?.weightChanges && result.policyDiff.weightChanges.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">权重 diff</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm font-mono">
                  {result.policyDiff.weightChanges.map((c) => (
                    <li key={c.key}>
                      {c.kind} {c.key}: {c.from ?? "—"} → {c.to ?? "—"}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {result.rankPreview?.available && result.rankPreview.movers && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">榜位预览（最新快照）</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-1 pr-2">实体</th>
                        <th className="py-1 pr-2">from</th>
                        <th className="py-1 pr-2">to</th>
                        <th className="py-1">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rankPreview.movers.slice(0, 25).map((m) => (
                        <tr key={m.entityId} className="border-b border-border/50">
                          <td className="py-1 pr-2">{m.canonicalName}</td>
                          <td className="py-1 pr-2">{m.fromRank ?? "—"}</td>
                          <td className="py-1 pr-2">{m.toRank ?? "—"}</td>
                          <td className="py-1">{m.rankDelta ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {result.rankPreview && !result.rankPreview.available && (
            <p className="text-sm text-amber-600">榜位预览不可用：{result.rankPreview.reason}</p>
          )}
        </>
      )}

      {aiReport ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI 版本 Diff 报告</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{aiReport}</p>
          </CardContent>
        </Card>
      ) : null}

      {err && (
        <pre className="overflow-auto rounded bg-destructive/10 p-3 text-xs text-destructive">{err}</pre>
      )}

      <AdminFooterNav />
    </AdminPage>
  );
}

export default function VersionDiffPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">加载…</p>}>
      <VersionDiffPageInner />
    </Suspense>
  );
}
