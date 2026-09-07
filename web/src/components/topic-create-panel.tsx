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
} from "@/lib/backend-api-urls";
import { adminApiHeaders } from "@/lib/query-http";
import {
  buildTopicVersionPolicy,
  defaultTopicVersionPolicyForm,
  localDateTimeInputNow,
  localDateTimeInputToIso,
  TOPIC_POLICY_METRIC_KEYS,
  topicVersionPolicyFormFromTemplate,
  type TopicVersionPolicyForm,
} from "@/lib/topic-admin-create";
import {
  isTopicKindValue,
  TOPIC_KIND_OPTIONS,
  type TopicKindValue,
} from "@/lib/topic-kind";
import { useEffect, useState, type FormEvent } from "react";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

const METRIC_LABELS: Record<
  (typeof TOPIC_POLICY_METRIC_KEYS)[number],
  string
> = {
  streams: "播放/使用量",
  mentions: "提及量",
  social: "社交热度",
  news: "新闻热度",
};

export type CreatedTopic = {
  id: string;
  slug: string;
  title: string;
  kind: TopicKindValue;
  locale: string;
  kindStrategy?: unknown;
};

export type CreatedTopicVersion = {
  id: string;
  version: string;
  effectiveFrom?: string;
  frozen: boolean;
  policyJson: unknown;
};

type TopicCreatePanelProps = {
  currentTopic: Pick<CreatedTopic, "id" | "slug" | "title" | "kind"> | null;
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

  useEffect(() => {
    if (!currentTopic) return;
    setTemplateId("default");
    setVersionForm(defaultTopicVersionPolicyForm(currentTopic.kind));
    setVersionName("");
    setVersionFeedback("");
    setVersionSucceeded(false);
  }, [currentTopic]);

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

    setTopicSubmitting(true);
    setTopicFeedback("");
    try {
      const response = await fetch(adminTopicsUrl(), {
        method: "POST",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title, kind: newKind, locale }),
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
      setTopicFeedback(`已新建“${topic.title}”，并切换到这个话题。现在可以新建首个版本。`);
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
      setVersionForm(
        defaultTopicVersionPolicyForm(currentTopic?.kind ?? "SEMI_OBJECTIVE"),
      );
      return;
    }
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

  const preservedRequiredKeys = versionForm.requiredSignalKeys.filter(
    (key) =>
      !TOPIC_POLICY_METRIC_KEYS.includes(
        key as (typeof TOPIC_POLICY_METRIC_KEYS)[number],
      ),
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">新建话题</CardTitle>
          <CardDescription>
            先建立一个榜单主题。内部标识创建后不能修改；展示名称和榜单类型以后仍可调整。
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
                  placeholder="例如：全球 AI 工具热度榜"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                />
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
                  <option value="default">使用该榜单类型的默认规则</option>
                  {existingVersions.map((row) => (
                    <option key={row.id} value={row.id}>
                      复制版本 {row.version}{row.frozen ? "（已冻结）" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-version-entity-ids">参榜实体编号</Label>
                <Input
                  id="new-version-entity-ids"
                  placeholder="例如：12, 18, 25"
                  value={versionForm.entityIdsInput}
                  onChange={(event) =>
                    setVersionForm((current) => ({
                      ...current,
                      entityIdsInput: event.target.value,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  多个编号用逗号或空格分隔。系统会校验这些实体是否存在。
                </p>
              </div>

              <div className="space-y-2">
                <Label>指标权重</Label>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {TOPIC_POLICY_METRIC_KEYS.map((key) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs" htmlFor={`new-version-weight-${key}`}>
                        {METRIC_LABELS[key]}
                      </Label>
                      <Input
                        id={`new-version-weight-${key}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={versionForm.weights[key]}
                        onChange={(event) =>
                          setVersionForm((current) => ({
                            ...current,
                            weights: {
                              ...current.weights,
                              [key]: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  数字越大，这项数据对最终排名影响越大；不使用可填 0。
                </p>
              </div>

              <div className="space-y-2">
                <Label>必须有数据的指标</Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {TOPIC_POLICY_METRIC_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={versionForm.requiredSignalKeys.includes(key)}
                        onChange={(event) =>
                          setVersionForm((current) => ({
                            ...current,
                            requiredSignalKeys: event.target.checked
                              ? [...new Set([...current.requiredSignalKeys, key])]
                              : current.requiredSignalKeys.filter((value) => value !== key),
                          }))
                        }
                      />
                      {METRIC_LABELS[key]}
                    </label>
                  ))}
                </div>
                {preservedRequiredKeys.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    从旧版本保留的自定义必需指标：{preservedRequiredKeys.join("、")}
                  </p>
                ) : null}
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
