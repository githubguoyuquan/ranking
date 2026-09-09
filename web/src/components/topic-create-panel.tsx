"use client";

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
import {
  adminTopicsUrl,
  adminTopicVersionsUrl,
  adminTopicEntitiesRetryUrl,
  topicEntitiesUrl,
} from "@/lib/backend-api-urls";
import { adminApiHeaders } from "@/lib/query-http";
import {
  buildTopicVersionPolicy,
  defaultTopicVersionPolicyForm,
  localDateTimeInputNow,
  localDateTimeInputToIso,
  parseTopicMetricPlan,
  topicVersionPolicyFormFromTemplate,
  type TopicMetricPlan,
  type TopicVersionPolicyForm,
} from "@/lib/topic-admin-create";
import {
  isTopicKindValue,
  TOPIC_KIND_OPTIONS,
  type TopicKindValue,
} from "@/lib/topic-kind";
import {
  ENTITY_AUTOFILL_STATUS_LABELS,
  entityAutofillSelection,
  parseTopicEntityAutofill,
  type TopicEntityAutofill,
} from "@/lib/topic-entity-autofill";
import { useEffect, useRef, useState, type FormEvent } from "react";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base leading-6 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type CreatedTopic = {
  id: string;
  slug: string;
  title: string;
  kind: TopicKindValue;
  locale: string;
  kindStrategy?: unknown;
  metricPlan?: TopicMetricPlan | null;
};

export type CreatedTopicVersion = {
  id: string;
  version: string;
  effectiveFrom?: string;
  frozen: boolean;
  policyJson: unknown;
};

type TopicCreatePanelProps = {
  currentTopic: Pick<CreatedTopic, "id" | "slug" | "title" | "kind" | "metricPlan"> | null;
  existingVersions: CreatedTopicVersion[];
  onTopicCreated: (topic: CreatedTopic) => void;
  onVersionCreated: (version: CreatedTopicVersion) => void;
};

function responseMessage(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const message = body.message;
    if (Array.isArray(message)) return message.map(String).join("；");
    if (message != null) return String(message);
  } catch {
    // Fall through to the plain response body.
  }
  return text.trim() || `请求失败（HTTP ${status}）`;
}

function parseCreatedTopic(raw: unknown): CreatedTopic | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind != null ? String(value.kind) : "";
  if (
    value.id == null ||
    value.slug == null ||
    value.title == null ||
    !isTopicKindValue(kind)
  ) {
    return null;
  }
  return {
    id: String(value.id),
    slug: String(value.slug),
    title: String(value.title),
    kind,
    locale: String(value.locale ?? ""),
    kindStrategy: value.kindStrategy,
    metricPlan: parseTopicMetricPlan(value.metricPlan),
  };
}

function parseCreatedVersion(raw: unknown): CreatedTopicVersion | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.id == null || value.version == null) return null;
  return {
    id: String(value.id),
    version: String(value.version),
    effectiveFrom:
      value.effectiveFrom != null ? String(value.effectiveFrom) : undefined,
    frozen: value.frozen === true,
    policyJson: value.policyJson,
  };
}

export function TopicCreatePanel({
  currentTopic,
  existingVersions,
  onTopicCreated,
  onVersionCreated,
}: TopicCreatePanelProps) {
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<TopicKindValue>("SEMI_OBJECTIVE");
  const [newLocale, setNewLocale] = useState("zh-CN");
  const [newEntityCount, setNewEntityCount] = useState("10");
  const [topicSubmitting, setTopicSubmitting] = useState(false);
  const [topicFeedback, setTopicFeedback] = useState("");
  const [topicSucceeded, setTopicSucceeded] = useState(false);

  const [versionName, setVersionName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [templateId, setTemplateId] = useState("default");
  const [versionForm, setVersionForm] = useState<TopicVersionPolicyForm>(() =>
    defaultTopicVersionPolicyForm("SEMI_OBJECTIVE"),
  );
  const [versionSubmitting, setVersionSubmitting] = useState(false);
  const [versionFeedback, setVersionFeedback] = useState("");
  const [versionSucceeded, setVersionSucceeded] = useState(false);
  const [populationState, setPopulationState] = useState<{
    slug: string;
    data: TopicEntityAutofill | null;
    loading: boolean;
    error: string;
  } | null>(null);
  const [populationRefresh, setPopulationRefresh] = useState(0);
  const [retryingSlug, setRetryingSlug] = useState<string | null>(null);
  const entityInputMode = useRef<"automatic" | "manual" | "template">("automatic");
  const topicSlug = currentTopic?.slug ?? "";
  const topicId = currentTopic?.id;
  const topicKind = currentTopic?.kind;
  const topicMetricPlan = currentTopic?.metricPlan;
  const population = populationState?.slug === topicSlug ? populationState.data : null;
  const populationError = populationState?.slug === topicSlug ? populationState.error : "";
  const populationLoading = !!topicSlug && (populationState?.slug !== topicSlug || populationState.loading);
  const populationWaiting = population?.status === "queued" || population?.status === "running";
  const populationStalled = populationWaiting && !!population?.updatedAt &&
    Date.now() - new Date(population.updatedAt).getTime() > 180_000;
  const selectedEntityIds = new Set(versionForm.entityIdsInput.split(/[\s,，]+/).filter(Boolean));

  useEffect(() => {
    entityInputMode.current = "automatic";
    setTemplateId("default");
    setVersionForm(defaultTopicVersionPolicyForm(topicKind ?? "SEMI_OBJECTIVE", topicMetricPlan));
    setVersionName("");
    setEffectiveFrom("");
    setVersionFeedback("");
    setVersionSucceeded(false);
  }, [topicId, topicSlug, topicKind, topicMetricPlan]);

  useEffect(() => {
    if (!topicSlug) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    setPopulationState((previous) => ({
      slug: topicSlug,
      data: previous?.slug === topicSlug ? previous.data : null,
      loading: true,
      error: "",
    }));
    async function loadPopulation() {
      try {
        const response = await fetch(topicEntitiesUrl(topicSlug), {
          headers: adminApiHeaders(), cache: "no-store", signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) throw new Error(responseMessage(response.status, text));
        // Nest responds with an empty body for null on legacy topics without a task.
        const raw = text.trim() ? JSON.parse(text) as unknown : null;
        const data = parseTopicEntityAutofill(raw);
        if (raw !== null && !data) throw new Error("无法识别实体填充结果，请稍后重新加载。");
        if (disposed) return;
        setPopulationState({ slug: topicSlug, data, loading: false, error: "" });
        if (data && entityInputMode.current === "automatic") {
          const selection = entityAutofillSelection(data);
          if (selection) setVersionForm((current) => ({ ...current, entityIdsInput: selection }));
        }
        if (data?.status === "queued" || data?.status === "running") {
          timer = setTimeout(loadPopulation, 3000);
        }
      } catch (error) {
        if (disposed) return;
        setPopulationState((previous) => ({
          slug: topicSlug,
          data: previous?.slug === topicSlug ? previous.data : null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        timer = setTimeout(loadPopulation, 10000);
      }
    }
    void loadPopulation();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [topicSlug, topicKind, populationRefresh]);

  async function retryPopulation() {
    if (!topicSlug) return;
    const retrySlug = topicSlug;
    setRetryingSlug(retrySlug);
    try {
      const response = await fetch(adminTopicEntitiesRetryUrl(retrySlug), {
        method: "POST", headers: adminApiHeaders(),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(responseMessage(response.status, text));
      setPopulationRefresh((value) => value + 1);
    } catch (error) {
      setPopulationState((previous) => previous?.slug === retrySlug ? {
        ...previous,
        error: error instanceof Error ? error.message : String(error),
      } : previous);
    } finally {
      setRetryingSlug((value) => value === retrySlug ? null : value);
    }
  }

  function useFoundEntities() {
    if (!population) return;
    const selection = entityAutofillSelection(population, true);
    if (!selection) return;
    entityInputMode.current = "manual";
    setVersionForm((current) => ({ ...current, entityIdsInput: selection }));
    setVersionFeedback(`已选择 ${population.entities.length} 个参榜对象，请继续填写版本名称和生效时间。`);
    setVersionSucceeded(true);
  }

  async function submitTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = newSlug.trim();
    const title = newTitle.trim();
    const locale = newLocale.trim();
    setTopicSucceeded(false);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setTopicFeedback("内部标识只能使用小写字母、数字和单个连字符，例如 ai-tools。");
      return;
    }
    if (!title) {
      setTopicFeedback("请填写对外展示名称。");
      return;
    }
    if (!locale) {
      setTopicFeedback("请填写语言地区，例如 zh-CN。");
      return;
    }
    const entityCount = Number(newEntityCount);
    if (!Number.isSafeInteger(entityCount) || entityCount < 1) {
      setTopicFeedback("参榜对象数量请填写正整数。");
      return;
    }

    setTopicSubmitting(true);
    setTopicFeedback("");
    try {
      const response = await fetch(adminTopicsUrl(), {
        method: "POST",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title, kind: newKind, locale, entityCount }),
      });
      const text = await response.text();
      if (!response.ok) {
        setTopicFeedback(responseMessage(response.status, text));
        return;
      }
      const topic = parseCreatedTopic(JSON.parse(text) as unknown);
      if (!topic) {
        setTopicFeedback("话题已提交，但返回内容无法识别，请用下方查询框重新加载。");
        return;
      }
      setTopicSucceeded(true);
      setTopicFeedback(`已新建“${topic.title}”，已按话题生成 ${topic.metricPlan?.metrics.length ?? 0} 项指标，正在自动查找 ${entityCount} 个参榜对象。`);
      onTopicCreated(topic);
      setNewSlug("");
      setNewTitle("");
    } catch (error) {
      setTopicFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setTopicSubmitting(false);
    }
  }

  function selectTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId);
    setVersionFeedback("");
    if (!currentTopic || nextTemplateId === "default") {
      const selection = population ? entityAutofillSelection(population) : null;
      setVersionForm((current) => ({
        ...defaultTopicVersionPolicyForm(currentTopic?.kind ?? "SEMI_OBJECTIVE", currentTopic?.metricPlan),
        entityIdsInput: entityInputMode.current === "manual" ? current.entityIdsInput : selection ?? "",
      }));
      if (entityInputMode.current !== "manual") entityInputMode.current = "automatic";
      return;
    }
    entityInputMode.current = "template";
    const template = existingVersions.find((row) => row.id === nextTemplateId);
    setVersionForm(
      topicVersionPolicyFormFromTemplate(
        template?.policyJson,
        currentTopic.kind,
      ),
    );
  }

  async function submitVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVersionSucceeded(false);
    if (!currentTopic) {
      setVersionFeedback("请先查询或新建一个话题。");
      return;
    }
    if (population && entityInputMode.current === "automatic" && !entityAutofillSelection(population)) {
      setVersionFeedback(population.status === "partial"
        ? "找到的对象少于期望数量。请先查看名单，点击“使用已找到的对象”，或重试自动填充。"
        : "参榜对象尚未准备好，请先等待查找完成，或重试自动填充。");
      return;
    }
    const version = versionName.trim();
    if (!version) {
      setVersionFeedback("请填写版本名称，例如 2026.09 或 launch-v1。");
      return;
    }
    const effectiveFromIso = localDateTimeInputToIso(effectiveFrom);
    if (!effectiveFromIso) {
      setVersionFeedback("请选择版本生效时间。");
      return;
    }
    const built = buildTopicVersionPolicy(versionForm);
    if (!built.ok) {
      setVersionFeedback(built.message);
      return;
    }

    setVersionSubmitting(true);
    setVersionFeedback("");
    try {
      const response = await fetch(adminTopicVersionsUrl(currentTopic.slug), {
        method: "POST",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          effectiveFrom: effectiveFromIso,
          policyJson: built.policyJson,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        setVersionFeedback(responseMessage(response.status, text));
        return;
      }
      const created = parseCreatedVersion(JSON.parse(text) as unknown);
      if (!created) {
        setVersionFeedback("版本已提交，但返回内容无法识别，请重新加载版本列表。");
        return;
      }
      setVersionSucceeded(true);
      setVersionFeedback(`版本 ${created.version} 已新建。下一步可在版本列表中点击“跑榜”。`);
      setVersionName("");
      onVersionCreated(created);
    } catch (error) {
      setVersionFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setVersionSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">新建话题</CardTitle>
          <CardDescription>
            填写榜单主题和期望数量，系统会生成适合该话题的指标，并从公开知识库查找真实对象。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitTopic}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-topic-title">对外展示名称</Label>
                <Input
                  id="new-topic-title"
                  maxLength={200}
                  placeholder="填写你的榜单主题和对象范围"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  系统通过语义解析理解对象类别和明确条件，再从公开知识库查找并核验候选；不限定预设业务类别。无法可靠解析时会提示，不会擅自省略条件。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-topic-slug">内部标识</Label>
                <Input
                  id="new-topic-slug"
                  maxLength={160}
                  placeholder="例如：global-ai-tools"
                  value={newSlug}
                  onChange={(event) => setNewSlug(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  仅限小写字母、数字和连字符，创建后不可修改。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-topic-kind">榜单类型</Label>
                <select
                  id="new-topic-kind"
                  className={selectClass}
                  value={newKind}
                  onChange={(event) => {
                    if (isTopicKindValue(event.target.value)) {
                      setNewKind(event.target.value);
                    }
                  }}
                >
                  {TOPIC_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {TOPIC_KIND_OPTIONS.find((option) => option.value === newKind)?.hint}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-topic-locale">语言地区</Label>
                <Input
                  id="new-topic-locale"
                  maxLength={35}
                  placeholder="zh-CN"
                  value={newLocale}
                  onChange={(event) => setNewLocale(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="new-topic-entity-count">参榜对象数量</Label>
                <Input
                  id="new-topic-entity-count"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={newEntityCount}
                  onChange={(event) => setNewEntityCount(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  填写任意正整数，没有业务数量上限。数量越大，后台分批查询和核验所需时间越长；公开来源不足时会显示实际名单。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={topicSubmitting}>
                {topicSubmitting ? "正在新建…" : "新建并切换到该话题"}
              </Button>
              {topicFeedback ? (
                <p
                  className={topicSucceeded ? "text-sm text-emerald-700" : "text-sm text-destructive"}
                  role={topicSucceeded ? "status" : "alert"}
                >
                  {topicFeedback}
                </p>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新建版本</CardTitle>
          <CardDescription>
            {currentTopic
              ? `当前话题：${currentTopic.title}（${currentTopic.slug}）`
              : "先在下方查询现有话题，或在左侧新建话题。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentTopic ? (
            <section className="mb-5 space-y-3 rounded-lg border bg-muted/30 p-4" aria-label="参榜对象">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">参榜对象</h3>
                <p className="text-sm" role="status">
                  {population
                    ? `${ENTITY_AUTOFILL_STATUS_LABELS[population.status]} · 已找到 ${population.entities.length} / ${population.requestedCount} 个`
                    : populationLoading ? "正在加载参榜对象…" : "尚无自动填充记录"}
                </p>
              </div>
              {population ? (
                <>
                  {population.strategy ? <p className="text-sm text-muted-foreground">查找范围：{population.strategy}</p> : null}
                  {population.message ? <p className="text-sm text-muted-foreground">{population.message}</p> : null}
                  {populationWaiting ? (
                    <p className="text-sm text-muted-foreground">
                      系统正在后台查找，名单会自动更新。可以离开或刷新页面，稍后查询这个话题即可继续。
                      {populationStalled ? "等待已超过 3 分钟，可以重试；话题已保存，无需重复创建。" : ""}
                    </p>
                  ) : null}
                  {population.entities.length > 0 ? (
                    <>
                      <ul className="max-h-64 space-y-3 overflow-y-auto pr-2" aria-label="已找到的对象名单">
                        {population.entities.map((entity) => (
                          <li key={entity.id}>
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-medium">{entity.name}</span>
                              {entity.sourceUrl ? (
                                <a className="text-sm text-primary underline-offset-2 hover:underline" href={entity.sourceUrl} target="_blank" rel="noopener noreferrer">
                                  查看来源<span className="sr-only">：{entity.name}</span>
                                </a>
                              ) : null}
                            </div>
                            {entity.description ? <p className="text-sm text-muted-foreground">{entity.description}</p> : null}
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        以上为候选对象名单，顺序不代表排名。本次只填充对象资料；指标数据和榜单计算仍需后续操作。
                      </p>
                    </>
                  ) : null}
                  {population.status === "partial" ? (
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      期望 {population.requestedCount} 个，实际找到 {population.entities.length} 个。确认名单后，可以按已有数量创建版本，或重试继续查找。
                    </p>
                  ) : null}
                  {population.status === "failed" ? (
                    <p className="text-sm text-muted-foreground">
                      话题已保存。请按提示处理后重试；如主题不明确，可在下方修改展示名称，使参榜对象更明确。
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {(population.status === "completed" || population.status === "partial") && population.entities.length > 0 ? (
                      <Button type="button" variant="outline" size="sm" onClick={useFoundEntities}>
                        使用已找到的对象（{population.entities.length} 个）
                      </Button>
                    ) : null}
                    {(population.status === "partial" || population.status === "failed" || populationStalled) ? (
                      <Button type="button" variant="outline" size="sm" disabled={retryingSlug === topicSlug} onClick={() => void retryPopulation()}>
                        {retryingSlug === topicSlug ? "正在重试…" : "重试自动填充"}
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : !populationLoading && !populationError ? (
                <p className="text-sm text-muted-foreground">这个话题尚无自动填充记录，可继续使用原有版本或手动填写实体编号。</p>
              ) : null}
              {populationError ? (
                <div className="space-y-2">
                  <p className="text-sm text-destructive" role="alert">读取或更新名单失败：{populationError}。话题及已保存的数据不会丢失。</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPopulationRefresh((value) => value + 1)}>重新加载名单</Button>
                </div>
              ) : null}
            </section>
          ) : null}
          <form className="space-y-4" onSubmit={submitVersion}>
            <fieldset className="space-y-4" disabled={!currentTopic || versionSubmitting}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-version-name">版本名称</Label>
                  <Input
                    id="new-version-name"
                    maxLength={64}
                    placeholder="例如：2026.09"
                    value={versionName}
                    onChange={(event) => setVersionName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-version-effective-from">生效时间</Label>
                  <Input
                    id="new-version-effective-from"
                    type="datetime-local"
                    value={effectiveFrom}
                    onFocus={() => {
                      if (!effectiveFrom) setEffectiveFrom(localDateTimeInputNow());
                    }}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                  />
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => setEffectiveFrom(localDateTimeInputNow())}
                  >
                    设为现在
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-version-template">规则来源</Label>
                <select
                  id="new-version-template"
                  className={selectClass}
                  value={templateId}
                  onChange={(event) => selectTemplate(event.target.value)}
                >
                  <option value="default">使用系统按当前话题生成的指标</option>
                  {existingVersions.map((row) => (
                    <option key={row.id} value={row.id}>
                      复制版本 {row.version}{row.frozen ? "（已冻结）" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                {population ? (
                  <>
                    <p className="text-sm" role="status">
                      {selectedEntityIds.size > 0
                        ? `当前版本已选择 ${selectedEntityIds.size} 个参榜对象。`
                        : "等待选择参榜对象。足量找到后会自动填入；数量不足时请先确认上方名单。"}
                    </p>
                    {selectedEntityIds.size > 0 ? <p className="text-sm text-muted-foreground">{population.entities.filter((entity) => selectedEntityIds.has(entity.id)).map((entity) => entity.name).join("、")}</p> : null}
                  </>
                ) : null}
                <details open={!population}>
                  <summary className="cursor-pointer text-sm text-muted-foreground">{population ? "手动调整实体编号（可选）" : "参榜实体编号"}</summary>
                  <div className="mt-2 space-y-2">
                    <Label htmlFor="new-version-entity-ids">参榜实体编号</Label>
                    <Input
                      id="new-version-entity-ids"
                      placeholder="例如：12, 18, 25"
                      value={versionForm.entityIdsInput}
                      onChange={(event) => {
                        entityInputMode.current = "manual";
                        setVersionForm((current) => ({ ...current, entityIdsInput: event.target.value }));
                      }}
                    />
                    <p className="text-xs text-muted-foreground">多个编号用逗号或空格分隔。手动调整或复制旧版本后，自动更新名单不会覆盖你的选择。</p>
                  </div>
                </details>
              </div>

              <div className="space-y-2">
                <Label>指标权重</Label>
                {currentTopic?.metricPlan?.rationale && templateId === "default" ? (
                  <p className="text-sm text-muted-foreground">{currentTopic.metricPlan.rationale}</p>
                ) : null}
                {versionForm.usesLegacyFallback ? (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    这是动态指标功能上线前的话题或旧版本，暂时显示其原有指标；新建话题不会再套用这组固定指标。
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  {versionForm.metricDefinitions.map((metric) => (
                    <div key={metric.key} className="space-y-2 rounded-md border p-3">
                      <div>
                        <Label htmlFor={`new-version-weight-${metric.key}`}>
                          {metric.label}
                        </Label>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">{metric.key}</p>
                      </div>
                      <Input
                        id={`new-version-weight-${metric.key}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={versionForm.weights[metric.key] ?? ""}
                        onChange={(event) =>
                          setVersionForm((current) => ({
                            ...current,
                            weights: {
                              ...current.weights,
                              [metric.key]: event.target.value,
                            },
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">{metric.description}</p>
                      <details>
                        <summary className="cursor-pointer text-xs text-primary">查看数据口径与建议来源</summary>
                        <p className="mt-1 text-xs text-muted-foreground">统一换算为 0–100 分：{metric.normalizationGuide}</p>
                        {metric.sourceHints.length > 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">建议来源：{metric.sourceHints.join("、")}</p>
                        ) : null}
                      </details>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  权重已经自动归一化为合计 1。数字越大，该指标影响越大；运营人员仍可调整。
                </p>
              </div>

              <div className="space-y-2">
                <Label>必须有数据的指标</Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {versionForm.metricDefinitions.map((metric) => (
                    <label key={metric.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={versionForm.requiredSignalKeys.includes(metric.key)}
                        onChange={(event) =>
                          setVersionForm((current) => ({
                            ...current,
                            requiredSignalKeys: event.target.checked
                              ? [...new Set([...current.requiredSignalKeys, metric.key])]
                              : current.requiredSignalKeys.filter((value) => value !== metric.key),
                          }))
                        }
                      />
                      {metric.label}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!currentTopic || versionSubmitting}>
                {versionSubmitting ? "正在新建…" : "新建版本"}
              </Button>
              {versionFeedback ? (
                <p
                  className={versionSucceeded ? "text-sm text-emerald-700" : "text-sm text-destructive"}
                  role={versionSucceeded ? "status" : "alert"}
                >
                  {versionFeedback}
                </p>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
