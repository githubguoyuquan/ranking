import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AdminFooterNav } from "@/components/admin-footer-nav";
import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
import { CopySnapshotIdButton, CopyTextButton } from "@/components/copy-snapshot-id-button";
import {
  SnapshotAnalysesSection,
  type SnapshotAnalysisListItem,
} from "@/components/snapshot-analyses-section";
import { SnapshotAnalysesFilter } from "@/components/snapshot-analyses-filter";
import { SnapshotAnalysesPagination } from "@/components/snapshot-analyses-pagination";
import { SnapshotAnalyzeActions } from "@/components/snapshot-analyze-actions";
import { SnapshotScoreBreakdownCell } from "@/components/snapshot-score-breakdown-cell";
import { SnapshotBarChart } from "@/components/snapshot-bar-chart";
import { DECIMAL_BIGINT_ID_MAX_DIGITS, isDecimalBigIntIdString } from "@/lib/decimal-id";
import {
  ADMIN_HREF,
  rankingsRunAdminPath,
  snapshotDetailAdminPath,
  snapshotsCompareAdminPath,
  topicsAdminPath,
} from "@/lib/admin-web-paths";
import { entitiesAdminPrefillPath } from "@/lib/entities-admin-path";
import {
  nestRankingStatusUrl,
  nestSnapshotAnalysesUrl,
  nestSnapshotScoreBreakdownsUrl,
  nestSnapshotV1Url,
} from "@/lib/nest-api-urls";
import { compareIdsFromRankingSnapshots } from "@/lib/snapshot-compare-pair";
import { parseSnapshotAnalysesApiResponse } from "@/lib/snapshot-analyses-api";
import { parseSnapshotPageAnalysisKind } from "@/lib/snapshot-analysis-kind-query";
import {
  SNAPSHOT_DETAIL_QS,
  buildSnapshotDetailAdminQuery,
  pickFirstSearchParam,
  parseSnapshotAnalysisLimit,
  parseSnapshotAnalysisPage,
  snapshotAnalysisListOffset,
} from "@/lib/snapshot-detail-search-params";
import { unifiedSearchAdminPathFromQuery } from "@/lib/unified-search-admin-path";
import Link from "next/link";
import { notFound } from "next/navigation";

type SnapshotPayload = {
  id?: string;
  snapshotVersion?: string;
  snapshotTime?: string;
  confidenceScore?: number;
  /** 物化时写入的权重模型（旧快照可能为 null） */
  scoreModel?: {
    id?: string;
    name?: string;
    version?: string;
    weights?: unknown;
  } | null;
  /** `GET /v1/snapshots/:id?includeAiStats=1` */
  aiAnalysisCount?: number;
  hasFollowupBrief?: boolean;
  hasTrendBrief?: boolean;
  hasCredibilityBrief?: boolean;
  items?: Array<{
    rank: number;
    previousRank?: number | null;
    rankChange?: number | null;
    popularityScore?: number;
    /** `scoreEntity` 各 metricKey 加权贡献（与 `TopicVersion.policyJson.weights` 对齐） */
    scoreBreakdown?: unknown;
    entity?: { canonicalName?: string | null };
  }>;
  topicRanking?: {
    id?: string;
    topicVersion?: {
      id?: string;
      version?: string;
      topic?: { title?: string; slug?: string };
    };
  };
};

export default async function SnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    analysisKind?: string | string[];
    analysisPage?: string | string[];
    analysisLimit?: string | string[];
  }>;
}) {
  const [{ id: rawId }, sp] = await Promise.all([
    params,
    searchParams ??
      Promise.resolve(
        {} as {
          analysisKind?: string | string[];
          analysisPage?: string | string[];
          analysisLimit?: string | string[];
        },
      ),
  ]);
  const id = rawId?.trim() ?? "";
  if (!isDecimalBigIntIdString(id)) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-destructive">
          snapshot id 须为十进制数字（至多 {DECIMAL_BIGINT_ID_MAX_DIGITS}{" "}
          位），与后端 <code className="rounded bg-muted px-1 text-xs">BigInt</code>{" "}
          解析一致。
        </p>
        <p className="text-sm text-muted-foreground">
          当前路径片段：{" "}
          <code className="rounded bg-muted px-1 text-xs">
            {rawId === "" || rawId == null ? "（空）" : rawId}
          </code>
        </p>
        <Link href={ADMIN_HREF.home} className="block text-primary underline-offset-4 hover:underline">
          ← 返回概览
        </Link>
      </div>
    );
  }
  const rawKind = pickFirstSearchParam(sp, SNAPSHOT_DETAIL_QS.analysisKind);
  const analysisKind = parseSnapshotPageAnalysisKind(rawKind);
  const analysisPage = parseSnapshotAnalysisPage(
    pickFirstSearchParam(sp, SNAPSHOT_DETAIL_QS.analysisPage),
  );
  const analysisLimit = parseSnapshotAnalysisLimit(
    pickFirstSearchParam(sp, SNAPSHOT_DETAIL_QS.analysisLimit),
  );
  const listOffset = snapshotAnalysisListOffset(analysisPage, analysisLimit);
  const analysesApiQs = new URLSearchParams();
  analysesApiQs.set("limit", String(analysisLimit));
  analysesApiQs.set("offset", String(listOffset));
  if (analysisKind !== "") analysesApiQs.set("agentKind", analysisKind);
  const analysesFetchUrl = nestSnapshotAnalysesUrl(id, analysesApiQs);
  const scoreBreakdownsFetchUrl = nestSnapshotScoreBreakdownsUrl(id);
  const adminPageQs = buildSnapshotDetailAdminQuery({
    analysisKind,
    analysisPage,
    analysisLimit,
  });
  const adminPagePath = snapshotDetailAdminPath(
    id,
    adminPageQs.toString() ? adminPageQs : undefined,
  );

  const snapSummaryQs = new URLSearchParams();
  snapSummaryQs.set("includeAiStats", "1");
  const [res, analysesRes] = await Promise.all([
    fetch(nestSnapshotV1Url(id, snapSummaryQs), { cache: "no-store" }),
    fetch(analysesFetchUrl, { cache: "no-store" }),
  ]);
  if (res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-destructive">
          加载失败 HTTP {res.status}，请确认 API 与 snapshot id。
        </p>
        <Link href={ADMIN_HREF.home} className="mt-4 block text-primary underline-offset-4 hover:underline">
          ← 返回概览
        </Link>
      </div>
    );
  }
  const data = (await res.json()) as SnapshotPayload;
  let analysisRows: SnapshotAnalysisListItem[] = [];
  let analysesTotal: number | null = null;
  let analysesLoadError: string | null = null;
  if (!analysesRes.ok) {
    analysesLoadError = `简报列表加载失败 HTTP ${analysesRes.status}`;
  } else {
    try {
      const parsed = parseSnapshotAnalysesApiResponse(await analysesRes.json());
      analysisRows = parsed.rows;
      analysesTotal = parsed.total;
    } catch {
      analysesLoadError = "简报列表 JSON 解析失败";
    }
  }

  let compareSnapshotIds = [id];
  const trId = data.topicRanking?.id;
  if (trId != null && String(trId) !== "") {
    try {
      const stRes = await fetch(nestRankingStatusUrl(String(trId)), {
        cache: "no-store",
      });
      if (stRes.ok) {
        const stJson = (await stRes.json()) as { snapshots?: unknown };
        compareSnapshotIds = compareIdsFromRankingSnapshots(id, stJson.snapshots);
      }
    } catch {
      /* 忽略 status 失败，仍可用单 id 预填对比页 */
    }
  }
  const snapshotsCompareHref = snapshotsCompareAdminPath(compareSnapshotIds, {
    includeAiStats: true,
  });
  const compareLinkLabel =
    compareSnapshotIds.length >= 2
      ? "与同 ranking 相邻快照对比（含 AI 列）…"
      : "与其他快照对比（含 AI 列）…";

  const title =
    data.topicRanking?.topicVersion?.topic?.title ?? "排行榜快照";
  const topicSlug = data.topicRanking?.topicVersion?.topic?.slug;
  const topicVersionId = data.topicRanking?.topicVersion?.id;
  const topicRankingId = data.topicRanking?.id;

  const topicsHref =
    topicSlug != null && topicSlug !== ""
      ? topicsAdminPath(topicSlug)
      : null;
  const runHref =
    topicVersionId != null && topicVersionId !== ""
      ? rankingsRunAdminPath(String(topicVersionId))
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>
              id <code className="rounded bg-muted px-1 text-xs">{data.id}</code>
            </span>
            {data.id != null && data.id !== "" ? (
              <CopySnapshotIdButton id={String(data.id)} />
            ) : null}
            {data.snapshotVersion ? (
              <>
                {" "}
                · {data.snapshotVersion}
              </>
            ) : null}
            {data.snapshotTime ? (
              <>
                {" "}
                · {data.snapshotTime}
              </>
            ) : null}
          </p>
          {data.aiAnalysisCount != null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              AiAnalysis 共 {data.aiAnalysisCount} 条 · 跟进{" "}
              {data.hasFollowupBrief === true ? "是" : "否"} · 趋势{" "}
              {data.hasTrendBrief === true ? "是" : "否"} · 可信{" "}
              {data.hasCredibilityBrief === true ? "是" : "否"}
              <span className="ml-1 text-muted-foreground/70">
                （<code className="rounded bg-muted/80 px-1">includeAiStats</code>）
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2 sm:items-end">
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm">
            {topicsHref ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={topicsHref}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  话题 / 热榜
                </Link>
                <CopyAdminPageUrlButton
                  path={topicsHref}
                  idleLabel="复制话题页链接"
                  className="h-6"
                />
              </span>
            ) : null}
            {runHref ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={runHref}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  跑榜（预填版本）
                </Link>
                <CopyAdminPageUrlButton
                  path={runHref}
                  idleLabel="复制预填跑榜链接"
                  className="h-6"
                />
                {topicVersionId ? (
                  <CopyTextButton
                    text={topicVersionId}
                    idleLabel="复制 topicVersionId"
                    className="h-6"
                  />
                ) : null}
              </span>
            ) : null}
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={ADMIN_HREF.rankingsRun}
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                跑榜（空白表单）
              </Link>
              <CopyAdminPageUrlButton
                path={ADMIN_HREF.rankingsRun}
                idleLabel="复制跑榜空白页链接"
                className="h-6"
              />
            </span>
          </div>
          {topicRankingId ? (
            <div className="flex max-w-md flex-col items-end gap-1 text-right">
              <p className="text-[10px] text-muted-foreground">
                topicRankingId{" "}
                <code className="rounded bg-muted px-1">{topicRankingId}</code>
              </p>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <CopyTextButton
                  text={topicRankingId}
                  idleLabel="复制 rankingId"
                  className="h-6"
                />
                <a
                  href={nestRankingStatusUrl(topicRankingId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-primary underline-offset-4 hover:underline"
                >
                  DB status
                </a>
                <CopyTextButton
                  text={nestRankingStatusUrl(topicRankingId)}
                  idleLabel="复制 status URL"
                  className="h-6"
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {data.scoreModel != null &&
      typeof data.scoreModel === "object" &&
      data.scoreModel.id != null &&
      data.scoreModel.id !== "" ? (
        <div className="rounded-md border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground/90">ScoreModel（本快照物化所用权重模型）</div>
          <p className="mt-1">
            <code className="rounded bg-muted px-1">{data.scoreModel.id}</code>
            {data.scoreModel.name != null && data.scoreModel.name !== "" ? (
              <> · {data.scoreModel.name}</>
            ) : null}
            {data.scoreModel.version != null && data.scoreModel.version !== "" ? (
              <>
                {" "}
                · <span className="break-all">{data.scoreModel.version}</span>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/90">
            关系表 <code className="rounded bg-muted/80 px-1">ScoreBreakdown</code> 与条目一一对应；条目字段{" "}
            <code className="rounded bg-muted/80 px-1">scoreBreakdown</code> 为同次打分的 JSON 投影。
            扁平导出：<code className="rounded bg-muted/80 px-1">GET …/score-breakdowns</code>（页脚链）。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <CopyTextButton
              text={data.scoreModel.id}
              idleLabel="复制 model id"
              className="h-6"
            />
            {data.scoreModel.weights != null ? (
              <>
                <CopyTextButton
                  text={JSON.stringify(data.scoreModel.weights, null, 2)}
                  idleLabel="复制 weights JSON"
                  className="h-6"
                />
                <details className="w-full min-w-0">
                  <summary className="cursor-pointer text-primary underline-offset-2 hover:underline">
                    查看 weights
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded border border-border/60 bg-background p-2 text-[11px] leading-snug">
                    {JSON.stringify(data.scoreModel.weights, null, 2)}
                  </pre>
                </details>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">得分分布（ECharts）</CardTitle>
          <CardDescription>
            横轴为 popularityScore（归一化），纵轴为实体名称 · 置信度{" "}
            {data.confidenceScore != null
              ? data.confidenceScore.toFixed(3)
              : "—"}
            · 点击柱条可在聚合搜索中打开该实体
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SnapshotBarChart items={data.items ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">原始条目</CardTitle>
          <CardDescription>
            rank / rankChange · <code className="rounded bg-muted px-1 text-xs">scoreBreakdown</code>{" "}
            为各信号经时间与 tier 衰减后的加权分量（展开查看）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">#</th>
                  <th scope="col" className="px-3 py-2 font-medium">实体</th>
                  <th scope="col" className="px-3 py-2 font-medium">分数</th>
                  <th scope="col" className="px-3 py-2 font-medium min-w-[7rem]">
                    信号分解
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">上次</th>
                  <th scope="col" className="px-3 py-2 font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {(data.items ?? [])
                  .slice()
                  .sort((a, b) => a.rank - b.rank)
                  .map((row) => (
                    <tr key={row.rank} className="border-b border-border/60">
                      <th scope="row" className="px-3 py-2 font-normal">
                        {row.rank}
                      </th>
                      <td className="px-3 py-2">
                        {row.entity?.canonicalName ? (
                          <>
                            <Link
                              href={unifiedSearchAdminPathFromQuery(
                                row.entity.canonicalName,
                              )}
                              className="text-primary underline-offset-2 hover:underline"
                            >
                              {row.entity.canonicalName}
                            </Link>
                            <div className="mt-0.5 text-[11px]">
                              <Link
                                href={entitiesAdminPrefillPath(
                                  row.entity.canonicalName,
                                )}
                                className="text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                              >
                                实体列表
                              </Link>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <CopyAdminPageUrlButton
                                path={unifiedSearchAdminPathFromQuery(
                                  row.entity.canonicalName,
                                )}
                                idleLabel="复制搜索页"
                                className="h-5 px-2 text-[10px]"
                              />
                              <CopyAdminPageUrlButton
                                path={entitiesAdminPrefillPath(
                                  row.entity.canonicalName,
                                )}
                                idleLabel="复制实体页"
                                className="h-5 px-2 text-[10px]"
                              />
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.popularityScore?.toFixed(4) ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <SnapshotScoreBreakdownCell raw={row.scoreBreakdown} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.previousRank ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.rankChange ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <SnapshotAnalysesSection
        rows={analysisRows}
        analysesJsonUrl={analysesFetchUrl}
        loadError={analysesLoadError}
        analysesTotal={analysesTotal}
        filterSlot={
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <SnapshotAnalysesFilter
              snapshotId={id}
              currentKind={analysisKind}
              listLimit={analysisLimit}
            />
            <SnapshotAnalysesPagination
              snapshotId={id}
              analysisKind={analysisKind}
              page={analysisPage}
              limit={analysisLimit}
              total={analysesTotal}
            />
          </div>
        }
      />

      <SnapshotAnalyzeActions snapshotId={id} analysesGetUrl={analysesFetchUrl} />

      <AdminFooterNav
        leading={
          <>
            <a
              href={nestSnapshotV1Url(id)}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              GET 本快照（JSON）
            </a>
            <CopyTextButton
              text={nestSnapshotV1Url(id)}
              idleLabel="复制快照 URL"
              className="h-6"
            />
            <a
              href={analysesFetchUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              GET 简报列表（JSON）
            </a>
            <CopyTextButton
              text={analysesFetchUrl}
              idleLabel="复制简报列表 URL"
              className="h-6"
            />
            <a
              href={scoreBreakdownsFetchUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              GET ScoreBreakdown 表（JSON）
            </a>
            <CopyTextButton
              text={scoreBreakdownsFetchUrl}
              idleLabel="复制 score-breakdowns URL"
              className="h-6"
            />
            <Link
              href={snapshotsCompareHref}
              className="text-primary underline-offset-4 hover:underline"
            >
              {compareLinkLabel}
            </Link>
            <CopyAdminPageUrlButton
              path={snapshotsCompareHref}
              idleLabel="复制对比页链接"
              className="h-6"
            />
            <CopyAdminPageUrlButton
              path={adminPagePath}
              idleLabel="复制本站快照页链接"
              className="h-6"
            />
          </>
        }
      />
    </div>
  );
}
