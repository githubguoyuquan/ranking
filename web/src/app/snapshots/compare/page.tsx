"use client";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
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
import { COMPARE_SNAPSHOT_IDS_INPUT_MAX_LEN } from "@/lib/admin-input-limits";
import {
  DECIMAL_BIGINT_ID_MAX_DIGITS,
  isDecimalBigIntIdString,
} from "@/lib/decimal-id";
import { snapshotDetailAdminPath, snapshotsCompareAdminPath } from "@/lib/admin-web-paths";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { entitiesAdminPrefillPath } from "@/lib/entities-admin-path";
import { NEST_V1 } from "@/lib/nest-api-paths";
import { nestRankingStatusUrl, nestSnapshotCompareUrl } from "@/lib/nest-api-urls";
import { unifiedSearchAdminPathFromQuery } from "@/lib/unified-search-admin-path";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

function snapshotIdsFromInput(input: string): string[] {
  return input.split(",").map((s) => s.trim()).filter(Boolean);
}

type CompareResponse = {
  topicRankingId?: string;
  snapshots?: Array<{
    id: string;
    snapshotTime: string;
    snapshotVersion: string;
    aiAnalysisCount?: number;
    hasFollowupBrief?: boolean;
    hasTrendBrief?: boolean;
    hasCredibilityBrief?: boolean;
  }>;
  rowCount?: number;
  rows?: Array<{
    entityId: string;
    canonicalName: string;
    bySnapshot: Record<
      string,
      {
        rank: number;
        popularityScore: number;
        rankChange: number | null;
      }
    >;
  }>;
};

function formatShortTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function snapshotAiBriefCaption(s: NonNullable<CompareResponse["snapshots"]>[number]) {
  if (typeof s.aiAnalysisCount !== "number") return null;
  const kinds: string[] = [];
  if (s.hasFollowupBrief) kinds.push("跟进");
  if (s.hasTrendBrief) kinds.push("趋势");
  if (s.hasCredibilityBrief) kinds.push("可信度");
  return (
    <div className="text-[10px] font-normal normal-case leading-snug opacity-90">
      Ai 简报 {s.aiAnalysisCount}
      {kinds.length > 0 ? ` · ${kinds.join(" · ")}` : ""}
    </div>
  );
}

function CompareSnapshotsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [idsInput, setIdsInput] = useState("");
  const [includeAiStats, setIncludeAiStats] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<CompareResponse | null>(null);
  const { origin, abs } = useAdminAppUrl();

  useEffect(() => {
    const ids = sp.get("ids");
    if (!ids?.trim()) return;
    const t = ids.trim();
    setIdsInput(
      t.length <= COMPARE_SNAPSHOT_IDS_INPUT_MAX_LEN
        ? t
        : t.slice(0, COMPARE_SNAPSHOT_IDS_INPUT_MAX_LEN),
    );
  }, [sp]);

  useEffect(() => {
    const raw = sp.get("includeAiStats");
    setIncludeAiStats(
      raw === "1" || (typeof raw === "string" && raw.toLowerCase() === "true"),
    );
  }, [sp]);

  const parsedIds = useMemo(() => snapshotIdsFromInput(idsInput), [idsInput]);
  const invalidSnapshotIds = useMemo(
    () => parsedIds.filter((id) => !isDecimalBigIntIdString(id)),
    [parsedIds],
  );
  const canCompare =
    parsedIds.length >= 2 &&
    parsedIds.length <= 10 &&
    invalidSnapshotIds.length === 0;
  const comparePostBody = useMemo(() => {
    if (!canCompare) return "";
    const body: { snapshotIds: string[]; includeAiStats?: boolean } = {
      snapshotIds: parsedIds,
    };
    if (includeAiStats) body.includeAiStats = true;
    return JSON.stringify(body);
  }, [canCompare, parsedIds, includeAiStats]);
  const compareSharePath = useMemo(
    () =>
      canCompare
        ? snapshotsCompareAdminPath(parsedIds, {
            includeAiStats: includeAiStats || undefined,
          })
        : "",
    [canCompare, parsedIds, includeAiStats],
  );

  async function run() {
    const snapshotIds = snapshotIdsFromInput(idsInput);
    if (snapshotIds.length < 2) {
      setError("至少需要 2 个 snapshot id（英文逗号分隔）");
      setData(null);
      return;
    }
    if (snapshotIds.length > 10) {
      setError(`至多 10 个 snapshot id（与 POST ${NEST_V1.snapshotsCompare} 一致）。`);
      setData(null);
      return;
    }
    const bad = snapshotIds.filter((id) => !isDecimalBigIntIdString(id));
    if (bad.length > 0) {
      setError(
        `下列 id 须为十进制快照主键（至多 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位数字，与后端 BigInt 一致）：${bad.join(", ")}`,
      );
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetch(nestSnapshotCompareUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotIds,
          ...(includeAiStats ? { includeAiStats: true } : {}),
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        setError(`HTTP ${res.status}\n${text}`);
        return;
      }
      setData(JSON.parse(text) as CompareResponse);
      router.replace(
        snapshotsCompareAdminPath(snapshotIds, {
          includeAiStats: includeAiStats || undefined,
        }),
        { scroll: false },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const snapshots = data?.snapshots ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">快照对比</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1">POST {NEST_V1.snapshotsCompare}</code>
          — 须为同一 <code className="rounded bg-muted px-1 text-xs">TopicRanking</code>{" "}
          下 2–10 张快照；每个 id 须为十进制数字（与后端{" "}
          <code className="rounded bg-muted px-1 text-xs">BigInt</code> 一致）。URL 可加{" "}
          <code className="rounded bg-muted px-1 text-xs">?ids=</code>
          （英文逗号分隔的 id 列表）；可选{" "}
          <code className="rounded bg-muted px-1 text-xs">includeAiStats=1</code>{" "}
          预勾选「合并 AI 简报统计」。
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyTextButton
            text={nestSnapshotCompareUrl()}
            idleLabel="复制 POST URL"
            className="h-6"
          />
          <span className="text-muted-foreground/90">POST + JSON（snapshotIds）</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快照 id</CardTitle>
          <CardDescription>
            逗号分隔，顺序决定表格列序；对比成功后地址栏会同步为{" "}
            <code className="text-xs">?ids=</code>。无{" "}
            <code className="text-xs">?ids=</code>{" "}
            时不预填示例 id，请从演示数据或快照详情复制。同一请求 2–10
            个 id；每个 id 须为十进制数字（至多{" "}
            <code className="text-xs">{DECIMAL_BIGINT_ID_MAX_DIGITS}</code> 位，与后端{" "}
            <code className="text-xs">BigInt</code> 解析一致）。整段输入建议不超过{" "}
            <code className="text-xs">{COMPARE_SNAPSHOT_IDS_INPUT_MAX_LEN}</code>{" "}
            字符（含逗号与空格）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ids">snapshotIds</Label>
            <Input
              id="ids"
              maxLength={COMPARE_SNAPSHOT_IDS_INPUT_MAX_LEN}
              value={idsInput}
              onChange={(e) => setIdsInput(e.target.value)}
              placeholder="例：从演示数据粘贴两张快照 id"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || loading || !canCompare) return;
                void run();
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="compare-include-ai-stats"
              className="size-4 rounded border border-input accent-primary"
              checked={includeAiStats}
              onChange={(e) => setIncludeAiStats(e.target.checked)}
            />
            <Label htmlFor="compare-include-ai-stats" className="text-sm font-normal">
              POST 体含 <code className="rounded bg-muted px-1 text-xs">includeAiStats</code>
              ，响应每列快照附带简报条数与类型标记
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={loading || !canCompare}
              onClick={() => void run()}
            >
              {loading ? "对比中…" : "对比"}
            </Button>
            {idsInput.trim() !== "" ? (
              <CopyTextButton
                text={idsInput.trim()}
                idleLabel="复制输入框 ids"
                className="h-8"
              />
            ) : null}
          </div>
          {comparePostBody ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <CopyTextButton
                text={comparePostBody}
                idleLabel="复制 POST 体"
                className="h-8"
              />
              {compareSharePath ? (
                <>
                  <CopyTextButton
                    text={compareSharePath}
                    idleLabel="复制对比页路径"
                    className="h-8"
                  />
                  {origin ? (
                    <CopyTextButton
                      text={abs(compareSharePath)}
                      idleLabel="复制对比页完整 URL"
                      className="h-8"
                    />
                  ) : null}
                </>
              ) : null}
            </p>
          ) : null}

          {parsedIds.length >= 2 &&
          parsedIds.length <= 10 &&
          invalidSnapshotIds.length > 0 ? (
            <p className="text-xs text-destructive">
              下列 id 格式无效（须为十进制，至多 {DECIMAL_BIGINT_ID_MAX_DIGITS}{" "}
              位）：{invalidSnapshotIds.join(", ")}
            </p>
          ) : null}

          {parsedIds.length > 10 ? (
            <p className="text-xs text-destructive">
              至多 10 个 snapshot id（与接口一致），请删去多余项后再对比。
            </p>
          ) : null}

          {error ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </pre>
          ) : null}

          {data?.topicRankingId ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>
                topicRankingId{" "}
                <code className="rounded bg-muted px-1">{data.topicRankingId}</code>
              </span>
              <CopyTextButton
                text={data.topicRankingId}
                idleLabel="复制 rankingId"
                className="h-6"
              />
              <span>· {data.rowCount ?? 0} 个实体（至少出现在一张快照中）</span>
              <a
                href={nestRankingStatusUrl(data.topicRankingId)}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                DB status（JSON）
              </a>
              <CopyTextButton
                text={nestRankingStatusUrl(data.topicRankingId)}
                idleLabel="复制 status URL"
                className="h-6"
              />
              {snapshots.length >= 2 ? (
                <>
                  {" · "}
                  <CopyTextButton
                    text={snapshots.map((s) => s.id).join(",")}
                    idleLabel="复制结果 ids"
                    className="h-6"
                  />
                </>
              ) : null}
            </p>
          ) : null}

          {snapshots.length > 0 && data?.rows && data.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-muted/90 px-3 py-2 font-medium backdrop-blur-sm"
                    >
                      实体
                    </th>
                    {snapshots.map((s) => (
                      <th key={s.id} scope="col" className="px-3 py-2 font-medium">
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex flex-wrap items-center gap-x-1">
                            <Link
                              href={snapshotDetailAdminPath(s.id)}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              #{s.id}
                            </Link>
                            <CopyAdminPageUrlButton
                              path={snapshotDetailAdminPath(s.id)}
                              idleLabel="复制"
                              className="h-5 px-1.5 text-[10px]"
                            />
                          </span>
                          <div className="text-[10px] font-normal normal-case opacity-90">
                            {formatShortTime(s.snapshotTime)}
                          </div>
                          {snapshotAiBriefCaption(s)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr
                      key={row.entityId}
                      className="border-b border-border/60 last:border-0"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-card px-3 py-2 font-normal backdrop-blur-sm"
                      >
                        <Link
                          href={unifiedSearchAdminPathFromQuery(row.canonicalName)}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {row.canonicalName}
                        </Link>
                        <div className="mt-0.5 text-[11px] font-normal">
                          <Link
                            href={entitiesAdminPrefillPath(row.canonicalName)}
                            className="text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                          >
                            实体列表
                          </Link>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                          <CopyTextButton
                            text={abs(unifiedSearchAdminPathFromQuery(row.canonicalName))}
                            idleLabel="复制搜索页"
                            className="h-5 px-2 text-[10px]"
                          />
                          <CopyTextButton
                            text={abs(entitiesAdminPrefillPath(row.canonicalName))}
                            idleLabel="复制实体页"
                            className="h-5 px-2 text-[10px]"
                          />
                        </div>
                      </th>
                      {snapshots.map((s) => {
                        const cell = row.bySnapshot[s.id];
                        return (
                          <td
                            key={s.id}
                            className="px-3 py-2 text-muted-foreground"
                          >
                            {cell ? (
                              <>
                                名次 {cell.rank}
                                <div className="text-[10px] opacity-80">
                                  score {cell.popularityScore.toFixed(3)}
                                  {cell.rankChange != null ? (
                                    <> · Δ {cell.rankChange}</>
                                  ) : null}
                                </div>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AdminFooterNav
        leading={
          parsedIds.length >= 1 ? (
            <>
              <Link
                href={snapshotDetailAdminPath(parsedIds[0])}
                className="text-primary underline-offset-4 hover:underline"
              >
                快照 #{parsedIds[0]}（首个输入 id）
              </Link>
              <CopyAdminPageUrlButton
                path={snapshotDetailAdminPath(parsedIds[0])}
                idleLabel="复制首张快照页链接"
                className="h-6"
              />
            </>
          ) : null
        }
      />
    </div>
  );
}

export default function CompareSnapshotsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">加载…</div>
      }
    >
      <CompareSnapshotsInner />
    </Suspense>
  );
}
