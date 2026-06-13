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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminEntitiesUrl, adminEntityByIdUrl, adminEntityMetricsUrl } from "@/lib/backend-api-urls";
import {
  BACKEND_ADMIN,
  BACKEND_ADMIN_DOC,
} from "@/lib/backend-api-paths";
import {
  ENTITY_ADMIN_LIST_LIMIT_DEFAULT,
  ENTITY_ADMIN_LIST_LIMIT_INPUT_MAX_LEN,
  ENTITY_ADMIN_LIST_LIMIT_MAX,
  ENTITY_ALIASES_CSV_INPUT_MAX_LEN,
  ENTITY_CANONICAL_NAME_MAX_LEN,
  ENTITY_LIST_Q_MAX_LEN,
  ENTITY_TYPE_MAX_LEN,
  TOPIC_SLUG_MAX_LEN,
} from "@/lib/admin-input-limits";
import { buildEntitiesListWebPath, entitiesAdminPrefillPath, normalizeEntityAdminListLimit } from "@/lib/entities-admin-path";
import { useAdminAppUrl } from "@/hooks/use-admin-app-url";
import { isDecimalBigIntIdString } from "@/lib/decimal-id";
import {
  ADMIN_HREF,
  entityRankHistoryAdminPath,
} from "@/lib/admin-web-paths";
import { NEST_V1_DOC } from "@/lib/nest-api-paths";
import { nestEntityMetricsUrl, nestEntityRankHistoryUrl } from "@/lib/nest-api-urls";
import { unifiedSearchAdminPathFromQuery } from "@/lib/unified-search-admin-path";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

type EntityRow = {
  id: string;
  type: string;
  canonicalName: string;
  aliases?: unknown;
};

function aliasesLabel(a: unknown): string {
  if (a == null) return "—";
  if (Array.isArray(a)) return a.filter((x) => typeof x === "string").join(", ");
  return JSON.stringify(a);
}

/** 与 `ENTITY_LIST_Q_MAX_LEN`（统一搜索 `q`）一致，避免超长 ILIKE 子串 */
function clampEntityListQ(raw: string): string {
  const t = raw.trim();
  if (t.length <= ENTITY_LIST_Q_MAX_LEN) return t;
  return t.slice(0, ENTITY_LIST_Q_MAX_LEN);
}

const ENTITY_RANK_TOPIC_SLUG_PLACEHOLDER = "global-female-singers";

function entityRankHistoryApiUrl(entityId: string, topicSlugInput: string): string {
  const slug =
    topicSlugInput.trim() || ENTITY_RANK_TOPIC_SLUG_PLACEHOLDER;
  return nestEntityRankHistoryUrl(
    entityId,
    new URLSearchParams({ topicSlug: slug, limit: "50" }),
  );
}

export default function EntitiesPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-none p-6 text-sm text-muted-foreground">
          加载…
        </div>
      }
    >
      <EntitiesPageInner />
    </Suspense>
  );
}

function EntitiesPageInner() {
  const { abs } = useAdminAppUrl();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [listQ, setListQ] = useState("");
  const listQRef = useRef(listQ);
  listQRef.current = listQ;
  const [listLimit, setListLimit] = useState(
    String(ENTITY_ADMIN_LIST_LIMIT_DEFAULT),
  );
  const listLimitRef = useRef(listLimit);
  listLimitRef.current = listLimit;
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [listError, setListError] = useState("");
  const [name, setName] = useState("New Artist");
  const [type, setType] = useState("PERSON");
  const [aliases, setAliases] = useState("A,B");
  const [createOut, setCreateOut] = useState("");
  const [edit, setEdit] = useState<EntityRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [editMsg, setEditMsg] = useState("");
  const [metricsOut, setMetricsOut] = useState("");
  const [metricKey, setMetricKey] = useState("streams");
  const [metricValue, setMetricValue] = useState("100");
  const [entityRankTopicSlug, setEntityRankTopicSlug] = useState(
    ENTITY_RANK_TOPIC_SLUG_PLACEHOLDER,
  );

  const listApiUrl = useMemo(() => {
    const params = new URLSearchParams({
      limit: normalizeEntityAdminListLimit(listLimit),
    });
    const q = listQ.trim();
    if (q) params.set("q", q);
    return adminEntitiesUrl(params);
  }, [listQ, listLimit]);

  const loadList = useCallback(async () => {
    setListError("");
    const q = listQRef.current.trim();
    try {
      const params = new URLSearchParams({
        limit: normalizeEntityAdminListLimit(listLimitRef.current),
      });
      if (q) params.set("q", q);
      const res = await fetch(adminEntitiesUrl(params), {
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) {
        setListError(`HTTP ${res.status}\n${text}`);
        setRows([]);
        return;
      }
      const data = JSON.parse(text) as unknown;
      if (!Array.isArray(data)) {
        setListError("响应不是数组");
        setRows([]);
        return;
      }
      setRows(data as EntityRow[]);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    const qp = searchParams.get("q");
    if (qp !== null) {
      const q = clampEntityListQ(qp);
      setListQ(q);
      listQRef.current = q;
    }
    const limp = searchParams.get("limit");
    if (limp !== null) {
      const lim = normalizeEntityAdminListLimit(limp);
      setListLimit(lim);
      listLimitRef.current = lim;
    }
    void loadList();
  }, [searchParams, loadList]);

  useEffect(() => {
    if (!edit) return;
    setEditName(edit.canonicalName);
    setEditType(edit.type);
    setEditAliases(aliasesLabel(edit.aliases).replace(/^—$/, ""));
    setMetricsOut("");
  }, [edit]);

  async function loadEntityMetrics(entityId: string) {
    setMetricsOut("");
    try {
      const res = await fetch(
        nestEntityMetricsUrl(entityId, new URLSearchParams({ latestOnly: "true", limit: "20" })),
        { cache: "no-store" },
      );
      setMetricsOut(`${res.status}\n${await res.text()}`);
    } catch (e) {
      setMetricsOut(e instanceof Error ? e.message : String(e));
    }
  }

  async function ingestEntityMetric(entityId: string) {
    setMetricsOut("");
    const key = metricKey.trim();
    const val = Number(metricValue);
    if (!key || !Number.isFinite(val)) {
      setMetricsOut("请填写有效 metricKey 与 value。");
      return;
    }
    try {
      const res = await fetch(adminEntityMetricsUrl(entityId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metrics: [
            {
              metricKey: key,
              value: val,
              observedAt: new Date().toISOString(),
              sourceTier: 2,
            },
          ],
        }),
      });
      const text = await res.text();
      setMetricsOut(`POST ${res.status}\n${text}`);
      if (res.ok) void loadEntityMetrics(entityId);
    } catch (e) {
      setMetricsOut(e instanceof Error ? e.message : String(e));
    }
  }

  async function createEntity() {
    setCreateOut("");
    const nm = name.trim();
    if (!nm) {
      setCreateOut("请填写 canonicalName。");
      return;
    }
    const al = aliases
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await fetch(adminEntitiesUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalName: nm,
          type: type.trim() || "PERSON",
          aliases: al.length ? al : undefined,
        }),
      });
      setCreateOut(await res.text());
      void loadList();
    } catch (e) {
      setCreateOut(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveEdit() {
    if (!edit) return;
    if (!isDecimalBigIntIdString(edit.id)) {
      setEditMsg("实体 id 格式无效（须为十进制），无法 PATCH。");
      return;
    }
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditMsg("canonicalName 不能为空");
      return;
    }
    setEditMsg("");
    const al = editAliases
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await fetch(adminEntityByIdUrl(edit.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalName: trimmedName,
          type: editType.trim() || undefined,
          aliases: al,
        }),
      });
      setEditMsg(`${res.status} ${await res.text()}`);
      if (res.ok) {
        setEdit(null);
        void loadList();
      }
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeEntity(id: string) {
    if (!isDecimalBigIntIdString(id)) {
      setEditMsg("实体 id 格式无效（须为十进制），已取消删除。");
      return;
    }
    if (!window.confirm(`删除实体 #${id}？（启用 ES 时先写 delete Outbox）`)) return;
    setEditMsg("");
    try {
      const res = await fetch(adminEntityByIdUrl(id), {
        method: "DELETE",
      });
      setEditMsg(`DELETE ${res.status} ${await res.text()}`);
      setEdit((e) => (e?.id === id ? null : e));
      void loadList();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">实体</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          GET {BACKEND_ADMIN.entities} · POST {BACKEND_ADMIN.entities} · PATCH/DELETE{" "}
          {BACKEND_ADMIN_DOC.entitiesId}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          「曲线」打开管理台{" "}
          <code className="rounded bg-muted px-1">{ADMIN_HREF.entityRankHistory}</code>{" "}
          （ECharts）；JSON 为{" "}
          <code className="rounded bg-muted px-1">GET {NEST_V1_DOC.entityRankHistory}</code>
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CopyTextButton
            text={adminEntitiesUrl()}
            idleLabel="复制 entities API URL"
            className="h-6"
          />
          <span className="text-muted-foreground/90">
            POST 创建；GET 同路径（可选 q、limit）
          </span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">列表</CardTitle>
          <CardDescription>
            按 canonicalName 子串筛选（<code className="text-xs">q</code> 最多 {ENTITY_LIST_Q_MAX_LEN}{" "}
            字符）· <code className="text-xs">limit</code> 1–{ENTITY_ADMIN_LIST_LIMIT_MAX}（与后端列表钳制一致，默认{" "}
            {ENTITY_ADMIN_LIST_LIMIT_DEFAULT}）· 表格内编辑/删除 · URL 预填{" "}
            <code className="text-xs">?q=</code> / <code className="text-xs">?limit=</code>；点「刷新」或{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-[10px]">Enter</kbd>{" "}
            会写入地址栏并重新拉取 · 「排行 topicSlug」用于一行内打开的{" "}
            <code className="text-xs">rank-history</code> JSON（默认与 seed 演示一致）
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="q">q</Label>
              <Input
                id="q"
                maxLength={ENTITY_LIST_Q_MAX_LEN}
                value={listQ}
                onChange={(e) => setListQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const path = buildEntitiesListWebPath(listQ, listLimit);
                  router.replace(path, { scroll: false });
                  void loadList();
                }}
              />
            </div>
            <div className="w-full space-y-2 sm:w-28">
              <Label htmlFor="entity-list-limit">limit</Label>
              <Input
                id="entity-list-limit"
                inputMode="numeric"
                maxLength={ENTITY_ADMIN_LIST_LIMIT_INPUT_MAX_LEN}
                placeholder={`1–${ENTITY_ADMIN_LIST_LIMIT_MAX}`}
                value={listLimit}
                onChange={(e) => setListLimit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const path = buildEntitiesListWebPath(listQ, listLimit);
                  router.replace(path, { scroll: false });
                  void loadList();
                }}
              />
            </div>
            <div className="w-full min-w-[10rem] space-y-2 sm:max-w-xs sm:flex-1">
              <Label htmlFor="entity-rank-topic-slug">排行 topicSlug</Label>
              <Input
                id="entity-rank-topic-slug"
                maxLength={TOPIC_SLUG_MAX_LEN}
                placeholder={ENTITY_RANK_TOPIC_SLUG_PLACEHOLDER}
                value={entityRankTopicSlug}
                onChange={(e) => setEntityRankTopicSlug(e.target.value)}
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                const path = buildEntitiesListWebPath(listQ, listLimit);
                router.replace(path, { scroll: false });
                void loadList();
              }}
            >
              刷新
            </Button>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <a
              href={listApiUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              新标签打开当前列表（GET {BACKEND_ADMIN.entities}）
            </a>
            <CopyTextButton
              text={listApiUrl}
              idleLabel="复制列表 API URL"
              className="h-6"
            />
            <CopyTextButton
              text={abs(buildEntitiesListWebPath(listQ, listLimit))}
              idleLabel="复制本页链接"
              className="h-6"
            />
          </p>
          {listError ? (
            <pre className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap">
              {listError}
            </pre>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">id</th>
                    <th scope="col" className="px-3 py-2 font-medium">名称</th>
                    <th scope="col" className="px-3 py-2 font-medium">类型</th>
                    <th scope="col" className="px-3 py-2 font-medium">别名</th>
                    <th scope="col" className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <th
                        scope="row"
                        className="px-3 py-2 font-mono text-xs font-normal"
                      >
                        {r.id}
                      </th>
                      <td className="px-3 py-2">
                        <Link
                          href={unifiedSearchAdminPathFromQuery(r.canonicalName)}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {r.canonicalName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.type}</td>
                      <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground">
                        {aliasesLabel(r.aliases)}
                      </td>
                      <td className="space-y-2 px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            asChild
                          >
                            <Link
                              href={entityRankHistoryAdminPath(
                                r.id,
                                entityRankTopicSlug,
                              )}
                            >
                              曲线
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            asChild
                          >
                            <Link
                              href={unifiedSearchAdminPathFromQuery(r.canonicalName)}
                            >
                              搜索
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setEdit(r)}
                          >
                            编辑
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => void removeEntity(r.id)}
                          >
                            删除
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href={entityRankHistoryApiUrl(r.id, entityRankTopicSlug)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-5 items-center rounded-md border border-border bg-background px-2 text-[10px] font-medium text-primary underline-offset-2 hover:underline"
                          >
                            rank-history
                          </a>
                          <CopyTextButton
                            text={entityRankHistoryApiUrl(r.id, entityRankTopicSlug)}
                            idleLabel="复制 rank-history"
                            className="h-5 px-2 text-[10px]"
                          />
                          <CopyTextButton
                            text={abs(
                              unifiedSearchAdminPathFromQuery(r.canonicalName),
                            )}
                            idleLabel="复制搜索页"
                            className="h-5 px-2 text-[10px]"
                          />
                          <CopyTextButton
                            text={abs(entitiesAdminPrefillPath(r.canonicalName))}
                            idleLabel="复制实体页"
                            className="h-5 px-2 text-[10px]"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">暂无数据</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {edit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">编辑 #{edit.id}</CardTitle>
            <CardDescription className="text-xs">
              输入框内{" "}
              <kbd className="rounded border border-border bg-muted px-1 text-[10px]">Enter</kbd>{" "}
              同「PATCH 保存」。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:col-span-2">
              <CopyTextButton
                text={adminEntityByIdUrl(edit.id)}
                idleLabel="复制实体 URL"
                className="h-6"
              />
              <span className="text-muted-foreground/90">
                用于 PATCH/DELETE（后端无 GET 单条）
              </span>
            </p>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="entity-edit-canonicalName">canonicalName</Label>
              <Input
                id="entity-edit-canonicalName"
                maxLength={ENTITY_CANONICAL_NAME_MAX_LEN}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !editName.trim()) return;
                  void saveEdit();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-edit-type">type</Label>
              <Input
                id="entity-edit-type"
                maxLength={ENTITY_TYPE_MAX_LEN}
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !editName.trim()) return;
                  void saveEdit();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entity-edit-aliases">
                aliases（逗号分隔；保存时覆盖）
              </Label>
              <Input
                id="entity-edit-aliases"
                maxLength={ENTITY_ALIASES_CSV_INPUT_MAX_LEN}
                value={editAliases}
                onChange={(e) => setEditAliases(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !editName.trim()) return;
                  void saveEdit();
                }}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>排行信号 EntityMetric</Label>
              <p className="text-xs text-muted-foreground">
                GET {NEST_V1_DOC.entityMetrics} · POST {BACKEND_ADMIN_DOC.entityMetrics}
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-[140px]"
                  value={metricKey}
                  onChange={(e) => setMetricKey(e.target.value)}
                  placeholder="metricKey"
                />
                <Input
                  className="max-w-[120px]"
                  value={metricValue}
                  onChange={(e) => setMetricValue(e.target.value)}
                  placeholder="value"
                />
                <Button type="button" variant="outline" onClick={() => void loadEntityMetrics(edit.id)}>
                  读最新信号
                </Button>
                <Button type="button" onClick={() => void ingestEntityMetric(edit.id)}>
                  POST 补数
                </Button>
              </div>
              {metricsOut ? (
                <pre className="max-h-40 overflow-auto text-xs whitespace-pre-wrap">{metricsOut}</pre>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button
                type="button"
                disabled={!editName.trim()}
                onClick={() => void saveEdit()}
              >
                PATCH 保存
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEdit(null)}>
                取消
              </Button>
            </div>
            {editMsg ? (
              <pre className="sm:col-span-2 text-xs whitespace-pre-wrap">{editMsg}</pre>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新建</CardTitle>
          <CardDescription>
            各字段按{" "}
            <kbd className="rounded border border-border bg-muted px-1 text-[10px]">Enter</kbd>{" "}
            同「POST」。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="entity-new-canonicalName">canonicalName</Label>
            <Input
              id="entity-new-canonicalName"
              maxLength={ENTITY_CANONICAL_NAME_MAX_LEN}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !name.trim()) return;
                void createEntity();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entity-new-type">type</Label>
            <Input
              id="entity-new-type"
              maxLength={ENTITY_TYPE_MAX_LEN}
              value={type}
              onChange={(e) => setType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !name.trim()) return;
                void createEntity();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entity-new-aliases">aliases（逗号分隔）</Label>
            <Input
              id="entity-new-aliases"
              maxLength={ENTITY_ALIASES_CSV_INPUT_MAX_LEN}
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !name.trim()) return;
                void createEntity();
              }}
            />
          </div>
          <Button
            type="button"
            disabled={!name.trim()}
            className="sm:col-span-2"
            onClick={() => void createEntity()}
          >
            POST {BACKEND_ADMIN.entities}
          </Button>
          {createOut ? (
            <pre className="sm:col-span-2 text-xs whitespace-pre-wrap">{createOut}</pre>
          ) : null}
        </CardContent>
      </Card>

      <AdminFooterNav />
    </div>
  );
}
