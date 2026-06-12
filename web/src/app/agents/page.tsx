"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { AdminPage } from "@/components/admin-page";
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
import { apiUrl } from "@/lib/api";
import { topicsAdminPath } from "@/lib/admin-web-paths";

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (key) return { ...h, "X-API-Key": key };
  return h;
}

type AgentDefinition = {
  id: string;
  category: string;
  description: string;
  requiredInput: string[];
  produces: string;
};

type AgentRunRow = {
  id: string;
  agent: string;
  status: string;
  correlationId: string;
  createdAt: string;
  error?: string | null;
  outputSummary?: string;
};

type ProposalRow = {
  id: string;
  status: string;
  suggestedSlug: string;
  suggestedTitle: string;
  confidence: number;
  clusterKey?: string | null;
};

function outputSummaryFromJson(outputJson: unknown): string | undefined {
  if (!outputJson || typeof outputJson !== "object") return undefined;
  const s = (outputJson as { summary?: unknown }).summary;
  return typeof s === "string" && s.trim() ? s.slice(0, 120) : undefined;
}

export default function AgentsPage() {
  const [registry, setRegistry] = useState<AgentDefinition[]>([]);
  const [snapshotPipeline, setSnapshotPipeline] = useState<string[]>([]);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [msg, setMsg] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [pipeline, setPipeline] = useState(
    "post-snapshot-summary-v1,trend-v1,credibility-v1,fact-check-v1,trend-analysis-v1",
  );

  const load = useCallback(async () => {
    setMsg("");
    try {
      const [ov, runRes, propRes] = await Promise.all([
        fetch(apiUrl("/admin/agents/overview"), { headers: apiHeaders() }),
        fetch(apiUrl("/admin/agents/runs?limit=30"), { headers: apiHeaders() }),
        fetch(apiUrl("/admin/agents/proposals?status=pending&limit=30"), {
          headers: apiHeaders(),
        }),
      ]);
      if (ov.ok) {
        const j = (await ov.json()) as {
          registry?: AgentDefinition[];
          snapshotPostProcessPipeline?: string[];
        };
        setRegistry(j.registry ?? []);
        setSnapshotPipeline(j.snapshotPostProcessPipeline ?? []);
      }
      if (runRes.ok) {
        const j = (await runRes.json()) as {
          runs?: Array<AgentRunRow & { outputJson?: unknown }>;
        };
        setRuns(
          (j.runs ?? []).map((r) => ({
            id: String(r.id),
            agent: r.agent,
            status: r.status,
            correlationId: r.correlationId,
            createdAt: r.createdAt,
            error: r.error,
            outputSummary: outputSummaryFromJson(r.outputJson),
          })),
        );
      }
      if (propRes.ok) {
        const j = (await propRes.json()) as { proposals?: ProposalRow[] };
        setProposals(
          (j.proposals ?? []).map((p) => ({
            id: String(p.id),
            status: p.status,
            suggestedSlug: p.suggestedSlug,
            suggestedTitle: p.suggestedTitle,
            confidence: p.confidence,
            clusterKey: p.clusterKey,
          })),
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(path: string, body?: unknown) {
    setMsg("");
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: apiHeaders(),
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    setMsg(res.ok ? `OK ${path}: ${text.slice(0, 500)}` : `${res.status} ${text.slice(0, 800)}`);
    if (res.ok) void load();
  }

  const snapshotAgents = registry.filter((r) => r.category === "snapshot");

  return (
    <AdminPage
      title="多 Agent 编排"
      description={
        <>
          统一 BullMQ 队列{" "}
          <code className="rounded bg-muted px-1 text-xs">ai-agent</code> 与{" "}
          <code className="rounded bg-muted px-1 text-xs">AgentRun</code>{" "}
          审计。物化后流水线由{" "}
          <code className="rounded bg-muted px-1 text-xs">
            RANKING_FOLLOWUP_AGENT_PIPELINE
          </code>{" "}
          配置。
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent 目录</CardTitle>
          <CardDescription>
            当前 env 快照流水线：
            {snapshotPipeline.length > 0
              ? snapshotPipeline.join(" → ")
              : "（未配置，默认不跑）"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {registry.map((a) => (
            <div
              key={a.id}
              className="rounded-md border border-border/60 p-3 text-sm"
            >
              <p className="font-mono text-xs font-medium">{a.id}</p>
              <p className="text-muted-foreground text-xs">
                {a.category} · {a.produces}
              </p>
              <p className="mt-1">{a.description}</p>
            </div>
          ))}
          {registry.length === 0 ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">流水线</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="space-y-2">
            <Label htmlFor="pipeline">逗号分隔 agents</Label>
            <Input
              id="pipeline"
              value={pipeline}
              onChange={(e) => setPipeline(e.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={() =>
              void post("/admin/agents/pipeline", {
                pipeline,
                input: snapshotId.trim()
                  ? { snapshotId: snapshotId.trim() }
                  : sourceId.trim()
                    ? { sourceId: sourceId.trim() }
                    : {},
              })
            }
          >
            入队 pipeline
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快照 Agent</CardTitle>
          <CardDescription>
            需 snapshotId；产出多为 AiAnalysis（{snapshotAgents.length} 个）
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="snapshot-id">snapshotId</Label>
            <Input
              id="snapshot-id"
              value={snapshotId}
              onChange={(e) => setSnapshotId(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!snapshotId.trim()}
              onClick={() =>
                void post("/admin/agents/factcheck/run", {
                  snapshotId: snapshotId.trim(),
                })
              }
            >
              fact-check-v1
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!snapshotId.trim()}
              onClick={() =>
                void post("/admin/agents/trend-analysis/run", {
                  snapshotId: snapshotId.trim(),
                })
              }
            >
              trend-analysis-v1
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!snapshotId.trim()}
              onClick={() =>
                void post("/admin/agents/time-series/run", {
                  snapshotId: snapshotId.trim(),
                })
              }
            >
              time-series-v1
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!snapshotId.trim()}
              onClick={() =>
                void post("/admin/agents/ranking/run", {
                  snapshotId: snapshotId.trim(),
                })
              }
            >
              ranking-agent-v1
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Topic Discovery</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="source-id">sourceId（可选）</Label>
            <Input
              id="source-id"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="1"
            />
          </div>
          <Button
            type="button"
            onClick={() =>
              void post("/admin/agents/discovery/run", {
                sourceId: sourceId.trim() || undefined,
              })
            }
          >
            运行 discovery
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Topic Merge</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>sourceTopicId</Label>
            <Input value={mergeSource} onChange={(e) => setMergeSource(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>targetTopicId</Label>
            <Input value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void post("/admin/agents/merge/run", {
                sourceTopicId: mergeSource.trim(),
                targetTopicId: mergeTarget.trim(),
                dryRun: true,
              })
            }
          >
            合并 dry-run
          </Button>
          <Button
            type="button"
            onClick={() =>
              void post("/admin/agents/merge/run", {
                sourceTopicId: mergeSource.trim(),
                targetTopicId: mergeTarget.trim(),
                dryRun: false,
                mergedBy: "admin-console",
              })
            }
          >
            执行合并（入队）
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">待审话题提案</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2">id</th>
                <th className="py-2 pr-2">slug</th>
                <th className="py-2 pr-2">title</th>
                <th className="py-2 pr-2">conf</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="py-2 pr-2 font-mono text-xs">{p.id}</td>
                  <td className="py-2 pr-2">{p.suggestedSlug}</td>
                  <td className="py-2 pr-2">{p.suggestedTitle}</td>
                  <td className="py-2 pr-2">{p.confidence.toFixed(2)}</td>
                  <td className="py-2 flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void post(`/admin/agents/proposals/${p.id}/approve`, {})
                      }
                    >
                      批准
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void post(`/admin/agents/proposals/${p.id}/reject`)
                      }
                    >
                      拒绝
                    </Button>
                    <a
                      className="text-xs text-primary underline"
                      href={topicsAdminPath(p.suggestedSlug)}
                    >
                      话题页
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {proposals.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">暂无 pending 提案</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">近期 AgentRun</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2">id</th>
                <th className="py-2 pr-2">agent</th>
                <th className="py-2 pr-2">status</th>
                <th className="py-2 pr-2">summary</th>
                <th className="py-2 pr-2">correlation</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="py-2 pr-2 font-mono text-xs">{r.id}</td>
                  <td className="py-2 pr-2">{r.agent}</td>
                  <td className="py-2 pr-2">{r.status}</td>
                  <td className="py-2 pr-2 max-w-[200px] truncate text-xs text-muted-foreground">
                    {r.outputSummary ?? "—"}
                  </td>
                  <td className="py-2 pr-2 font-mono text-[10px]">{r.correlationId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {msg ? (
        <p className="text-sm text-muted-foreground" role="status">
          {msg}
        </p>
      ) : null}

      <AdminFooterNav />
    </AdminPage>
  );
}
