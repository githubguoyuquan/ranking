import { AdminFooterNav } from "@/components/admin-footer-nav";
import { AdminQuickEntryRow } from "@/components/admin-quick-entry-row";
import { CopyAdminPageUrlButton } from "@/components/copy-admin-page-url-button";
import { CopyTextButton } from "@/components/copy-snapshot-id-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  backendAbs,
  backendHealthDbUrl,
  backendHealthKafkaUrl,
  backendHealthReadyUrl,
  backendHealthRedisUrl,
  backendHealthUrl,
} from "@/lib/backend-api-urls";
import {
  BACKEND_ADMIN,
  BACKEND_DOC,
  BACKEND_HEALTH,
} from "@/lib/backend-api-paths";
import { ADMIN_HREF, snapshotDetailAdminPath, topicsAdminPath } from "@/lib/admin-web-paths";
import { entitiesAdminPrefillPath } from "@/lib/entities-admin-path";
import { NEST_V1, NEST_V1_DOC } from "@/lib/nest-api-paths";
import { nestClickhouseHealthUrl, nestSearchHealthUrl, nestSnapshotScoreBreakdownsUrl } from "@/lib/nest-api-urls";
import { unifiedSearchAdminPathFromQuery } from "@/lib/unified-search-admin-path";

type FetchOk<T> = { ok: true; data: T };
type FetchErr = { ok: false; error: string; httpStatus?: number };
type FetchResult<T> = FetchOk<T> | FetchErr;

async function fetchJsonUrl<T>(url: string): Promise<FetchResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: text.trim() || `HTTP ${res.status}`,
        httpStatus: res.status,
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      return { ok: false, error: `非 JSON：${text.slice(0, 240)}` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "无法连接 API",
    };
  }
}

async function fetchJson<T>(path: string): Promise<FetchResult<T>> {
  return fetchJsonUrl<T>(backendAbs(path));
}

function optionalServiceBadge(args: { ok: boolean; detail?: string }) {
  if (args.ok) return <Badge>正常</Badge>;
  const d = args.detail ?? "";
  if (d.includes("not set")) {
    return <Badge variant="secondary">未配置</Badge>;
  }
  return <Badge variant="destructive">异常</Badge>;
}

function kafkaConfiguredBadge(data: {
  ok: boolean;
  configured: boolean;
} | null) {
  if (!data) return <Badge variant="outline">—</Badge>;
  if (!data.configured) return <Badge variant="secondary">未配置</Badge>;
  if (data.ok) return <Badge>正常</Badge>;
  return <Badge variant="destructive">异常</Badge>;
}

export default async function HomePage() {
  const [apiRes, dbRes, redisRes, kafkaRes, esRes, chRes] = await Promise.all([
    fetchJson<{ status?: string }>(BACKEND_HEALTH.root),
    fetchJson<{ ok: boolean; detail?: string }>(BACKEND_HEALTH.db),
    fetchJson<{
      ok: boolean;
      detail?: string;
      cacheReadsEnabled?: boolean;
    }>(BACKEND_HEALTH.redis),
    fetchJson<{
      ok: boolean;
      configured: boolean;
      detail?: string;
    }>(BACKEND_HEALTH.kafka),
    fetchJsonUrl<{ ok: boolean; clusterName?: string; detail?: string }>(
      nestSearchHealthUrl(),
    ),
    fetchJsonUrl<{ ok: boolean; detail?: string }>(nestClickhouseHealthUrl()),
  ]);

  const apiOk =
    apiRes.ok && apiRes.data.status === "ok";
  const apiBody = apiRes.ok ? apiRes.data : null;
  const apiErr = !apiRes.ok ? apiRes.error : null;

  const db = dbRes.ok ? dbRes.data : null;
  const dbErr = !dbRes.ok ? dbRes.error : null;

  const redis = redisRes.ok ? redisRes.data : null;
  const redisErr = !redisRes.ok ? redisRes.error : null;

  const kafka = kafkaRes.ok ? kafkaRes.data : null;
  const kafkaErr = !kafkaRes.ok ? kafkaRes.error : null;

  const es = esRes.ok ? esRes.data : null;
  const esErr = !esRes.ok ? esRes.error : null;

  const ch = chRes.ok ? chRes.data : null;
  const chErr = !chRes.ok ? chRes.error : null;

  const coreReady =
    !dbErr && !redisErr && db?.ok === true && redis?.ok === true;

  const openInNewTabApiDirectLinks: {
    url: string;
    pathLabel: string;
    copyLabel: string;
  }[] = [
    {
      url: backendHealthUrl(),
      pathLabel: BACKEND_HEALTH.root,
      copyLabel: "复制 liveness URL",
    },
    {
      url: backendHealthReadyUrl(),
      pathLabel: BACKEND_HEALTH.ready,
      copyLabel: "复制 ready URL",
    },
    {
      url: backendHealthDbUrl(),
      pathLabel: BACKEND_HEALTH.db,
      copyLabel: "复制 DB health URL",
    },
    {
      url: backendHealthRedisUrl(),
      pathLabel: BACKEND_HEALTH.redis,
      copyLabel: "复制 Redis health URL",
    },
    {
      url: backendHealthKafkaUrl(),
      pathLabel: BACKEND_HEALTH.kafka,
      copyLabel: "复制 Kafka health URL",
    },
    {
      url: nestSearchHealthUrl(),
      pathLabel: NEST_V1.searchHealth,
      copyLabel: "复制 ES health URL",
    },
    {
      url: nestClickhouseHealthUrl(),
      pathLabel: NEST_V1.clickhouseHealth,
      copyLabel: "复制 ClickHouse health URL",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          对接本地 Nest API（默认端口{" "}
          <code className="rounded bg-muted px-1">3000</code>、本站{" "}
          <code className="rounded bg-muted px-1">3001</code>
          ）。PostgreSQL 为必需；Redis 未启动时异步队列与读缓存不可用；Kafka
          / ES / ClickHouse 均为可选。
        </p>
        <p
          className={
            coreReady
              ? "mt-2 text-sm text-green-700 dark:text-green-400"
              : "mt-2 text-sm text-amber-700 dark:text-amber-400"
          }
        >
          {coreReady
            ? `核心依赖已满足，与 GET ${BACKEND_HEALTH.ready}（HTTP 200）一致。`
            : `核心依赖未全部满足时 GET ${BACKEND_HEALTH.ready} 返回 HTTP 503，直至 PostgreSQL 与 Redis 均可连。`}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyAdminPageUrlButton
            path={ADMIN_HREF.home}
            idleLabel="复制概览页链接"
            className="h-6"
          />
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">API</CardTitle>
              <Badge variant={apiOk ? "default" : "destructive"}>
                {apiOk ? "在线" : "离线 / 错误"}
              </Badge>
            </div>
            <CardDescription>
              <code className="text-xs">GET {BACKEND_HEALTH.root}</code>（存活 / liveness）
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {apiErr ? (
              <p className="text-destructive">{apiErr}</p>
            ) : (
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(apiBody, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">PostgreSQL</CardTitle>
              <Badge variant={db?.ok ? "default" : "destructive"}>
                {db?.ok ? "正常" : "异常"}
              </Badge>
            </div>
            <CardDescription>
              <code className="text-xs">GET {BACKEND_HEALTH.db}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {dbErr ? (
              <p className="text-destructive">{dbErr}</p>
            ) : (
              <>
                {!db?.ok ? (
                  <p className="text-muted-foreground">
                    {db?.detail ?? "不可用"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    <code className="rounded bg-muted px-1 text-xs">SELECT 1</code>{" "}
                    通过（Prisma）
                  </p>
                )}
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(db, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Redis</CardTitle>
              {optionalServiceBadge({
                ok: redis?.ok === true,
                detail: redis?.detail,
              })}
            </div>
            <CardDescription>
              <code className="text-xs">GET {BACKEND_HEALTH.redis}</code>
              （BullMQ + 读缓存）
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {redisErr ? (
              <p className="text-destructive">{redisErr}</p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  快照读缓存：{" "}
                  {redis?.cacheReadsEnabled !== false ? "开启" : "已关闭"}{" "}
                  <code className="rounded bg-muted px-1 text-[10px]">
                    RANKING_CACHE_ENABLED
                  </code>
                </p>
                {redis?.ok === true && redis?.cacheReadsEnabled !== false ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    键前缀示例：<code className="rounded bg-muted px-1">ranking:v2:snap:</code>、
                    <code className="rounded bg-muted px-1">ranking:v3:lb:</code>
                  </p>
                ) : null}
                {!redis?.ok ? (
                  <p className="mt-1 text-muted-foreground">
                    {redis?.detail ?? "不可用"}
                  </p>
                ) : null}
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(redis, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Kafka</CardTitle>
              {kafkaErr ? (
                <Badge variant="destructive">请求失败</Badge>
              ) : (
                kafkaConfiguredBadge(kafka)
              )}
            </div>
            <CardDescription>
              <code className="text-xs">GET {BACKEND_HEALTH.kafka}</code>
              （Outbox 发布）
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {kafkaErr ? (
              <p className="text-destructive">{kafkaErr}</p>
            ) : (
              <>
                {!kafka?.ok ? (
                  <p className="text-muted-foreground">
                    {kafka?.detail ?? "不可用"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    describeCluster 通过
                  </p>
                )}
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(kafka, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Elasticsearch</CardTitle>
              {optionalServiceBadge({
                ok: es?.ok === true,
                detail: es?.detail,
              })}
            </div>
            <CardDescription>
              <code className="text-xs">GET {NEST_V1.searchHealth}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {esErr ? (
              <p className="text-destructive">{esErr}</p>
            ) : (
              <>
                {es?.ok ? (
                  <p className="text-muted-foreground">
                    {es.clusterName ? `集群：${es.clusterName}` : "集群可达"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {es?.detail ?? "不可用"}
                  </p>
                )}
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(es, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">ClickHouse</CardTitle>
              {optionalServiceBadge({
                ok: ch?.ok === true,
                detail: ch?.detail,
              })}
            </div>
            <CardDescription>
              <code className="text-xs">GET {NEST_V1.clickhouseHealth}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {chErr ? (
              <p className="text-destructive">{chErr}</p>
            ) : (
              <>
                {!ch?.ok ? (
                  <p className="text-muted-foreground">
                    {ch?.detail ?? "不可用"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">SELECT 1 通过</p>
                )}
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(ch, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快速入口</CardTitle>
          <CardDescription>种子与排行、搜索与运维常用页</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <AdminQuickEntryRow href={ADMIN_HREF.seed} copyLabel="复制演示数据页链接">
            演示数据（POST {BACKEND_ADMIN.seedDemo}）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow href={ADMIN_HREF.rankingsRun} copyLabel="复制跑榜页链接">
            运行排行（POST {NEST_V1.rankingsRun}）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow
            href={topicsAdminPath("global-female-singers")}
            copyLabel="复制话题版本页链接"
          >
            话题版本查询
          </AdminQuickEntryRow>
          <AdminQuickEntryRow href={ADMIN_HREF.trends} copyLabel="复制热点趋势页链接">
            热点趋势（GET {NEST_V1_DOC.trendsHot}，聚合快照 TrendAnalysis）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow
            href={unifiedSearchAdminPathFromQuery("Swift")}
            copyLabel="复制搜索页链接"
          >
            聚合搜索（实体 + 爬取 URL，示例 q=Swift）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow href={ADMIN_HREF.reindex} copyLabel="复制索引维护页链接">
            索引维护（POST {BACKEND_DOC.reindexPrefix}）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow
            href={entitiesAdminPrefillPath("Swift")}
            copyLabel="复制实体列表示例链接"
          >
            实体列表（示例子串 q=Swift）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow href={ADMIN_HREF.entities} copyLabel="复制实体管理页链接">
            实体管理（无筛选）
          </AdminQuickEntryRow>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <a
              className="text-primary underline-offset-4 hover:underline"
              href={backendHealthReadyUrl()}
              target="_blank"
              rel="noreferrer"
            >
              GET {BACKEND_HEALTH.ready}（新标签）
            </a>
            <CopyTextButton
              text={backendHealthReadyUrl()}
              idleLabel="复制 ready URL"
              className="h-6"
            />
          </span>
          <AdminQuickEntryRow href={ADMIN_HREF.crawl} copyLabel="复制爬虫页链接">
            爬虫任务（含异步轮询）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow
            href={ADMIN_HREF.crawlMonitor}
            copyLabel="复制引擎监控页链接"
          >
            引擎监控甲板（实时遥测与任务入轨）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow href={ADMIN_HREF.outbox} copyLabel="复制 Outbox 页链接">
            Outbox 排查
          </AdminQuickEntryRow>
          <AdminQuickEntryRow
            href={ADMIN_HREF.snapshotsCompare}
            copyLabel="复制快照对比页链接"
          >
            快照对比（同一 ranking 多快照）
          </AdminQuickEntryRow>
          <AdminQuickEntryRow
            href={snapshotDetailAdminPath("1")}
            copyLabel="复制示例快照详情链接"
          >
            示例：快照详情（id=1，库中无存则 404）
          </AdminQuickEntryRow>
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <a
              className="text-primary underline-offset-4 hover:underline"
              href={nestSnapshotScoreBreakdownsUrl("1")}
              target="_blank"
              rel="noreferrer"
            >
              GET {NEST_V1_DOC.snapshotsScoreBreakdowns}（示例 id=1）
            </a>
            <CopyTextButton
              text={nestSnapshotScoreBreakdownsUrl("1")}
              idleLabel="复制 score-breakdowns URL"
              className="h-6"
            />
          </span>

          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-medium text-foreground">API 直链（新标签）</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {openInNewTabApiDirectLinks.map((item) => (
                <span
                  key={item.pathLabel}
                  className="inline-flex flex-wrap items-center gap-1.5"
                >
                  <a
                    className="text-primary underline-offset-4 hover:underline"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.pathLabel}
                  </a>
                  <CopyTextButton
                    text={item.url}
                    idleLabel={item.copyLabel}
                    className="h-6"
                  />
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <AdminFooterNav
        showBackToHome={false}
        className="mt-8 border-t border-border pt-6"
      />
    </div>
  );
}
