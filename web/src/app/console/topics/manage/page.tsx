"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { TopicModuleNav } from "@/components/topic-module-nav";
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
import { TOPIC_SLUG_MAX_LEN } from "@/lib/admin-input-limits";
import { topicsAdminPath } from "@/lib/admin-web-paths";
import { nestTopicUrl } from "@/lib/nest-api-urls";
import { adminApiHeaders } from "@/lib/query-http";
import {
  isTopicKindValue,
  TOPIC_KIND_OPTIONS,
  type TopicKindValue,
} from "@/lib/topic-kind";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base leading-6 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

type TopicDraft = {
  id: string;
  slug: string;
  title: string;
  entityScope: string;
  kind: TopicKindValue;
  locale: string;
};

function responseMessage(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const message = body.message;
    if (Array.isArray(message)) return message.map(String).join("；");
    if (message != null) return String(message);
  } catch {
    // 使用服务返回的纯文本。
  }
  return text.trim() || `请求失败（HTTP ${status}）`;
}

function ManageTopicPageInner() {
  const searchParams = useSearchParams();
  const [slug, setSlug] = useState("");
  const [topic, setTopic] = useState<TopicDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    const value = searchParams.get("slug")?.trim();
    if (value) setSlug(value.slice(0, TOPIC_SLUG_MAX_LEN));
  }, [searchParams]);

  async function loadTopic() {
    const target = slug.trim();
    if (!target) {
      setSucceeded(false);
      setFeedback("请先填写话题的内部标识。");
      return;
    }
    setLoading(true);
    setSucceeded(false);
    setFeedback("");
    try {
      const response = await fetch(nestTopicUrl(target), {
        headers: adminApiHeaders(),
        cache: "no-store",
      });
      const text = await response.text();
      if (!response.ok) {
        setTopic(null);
        setFeedback(responseMessage(response.status, text));
        return;
      }
      const body = JSON.parse(text) as Record<string, unknown>;
      const kind = String(body.kind ?? "");
      if (!isTopicKindValue(kind)) throw new Error("服务返回了无法识别的榜单类型。");
      setTopic({
        id: String(body.id ?? ""),
        slug: String(body.slug ?? target),
        title: String(body.title ?? ""),
        entityScope: String(body.entityScope ?? ""),
        kind,
        locale: String(body.locale ?? ""),
      });
      setSucceeded(true);
      setFeedback("已加载话题，可以修改下方属性。");
    } catch (error) {
      setTopic(null);
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function saveTopic() {
    if (!topic) return;
    if (!topic.title.trim() || !topic.entityScope.trim()) {
      setSucceeded(false);
      setFeedback("对外展示名称和参榜实体类别都不能为空。");
      return;
    }
    setSaving(true);
    setSucceeded(false);
    setFeedback("");
    try {
      const response = await fetch(nestTopicUrl(topic.slug), {
        method: "PATCH",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          title: topic.title.trim(),
          entityScope: topic.entityScope.trim(),
          kind: topic.kind,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        setFeedback(responseMessage(response.status, text));
        return;
      }
      const body = JSON.parse(text) as Record<string, unknown>;
      setTopic((current) => current ? {
        ...current,
        title: String(body.title ?? current.title),
        entityScope: String(body.entityScope ?? current.entityScope),
        kind: isTopicKindValue(String(body.kind ?? ""))
          ? String(body.kind) as TopicKindValue
          : current.kind,
      } : current);
      setSucceeded(true);
      setFeedback("话题属性已保存。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">管理话题</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查询一个已保存的话题，再修改展示名称、参榜实体类别或榜单类型。
        </p>
      </div>

      <TopicModuleNav current="manage" slug={topic?.slug ?? slug} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">查找话题</CardTitle>
          <CardDescription>填写创建话题时设置的内部标识（slug）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="manage-topic-slug">内部标识</Label>
              <Input
                id="manage-topic-slug"
                maxLength={TOPIC_SLUG_MAX_LEN}
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !loading) void loadTopic();
                }}
                placeholder="例如：global-ai-tools"
              />
            </div>
            <Button type="button" disabled={loading} onClick={() => void loadTopic()}>
              {loading ? "查询中…" : "查询话题"}
            </Button>
          </div>
          {feedback ? (
            <p className={succeeded ? "text-sm text-emerald-700" : "text-sm text-destructive"} role={succeeded ? "status" : "alert"}>
              {feedback}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {topic ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">修改话题属性</CardTitle>
            <CardDescription>
              内部标识和语言地区创建后不在这里修改，以免影响已有版本和链接。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="manage-topic-title">对外展示名称</Label>
                <Input id="manage-topic-title" maxLength={200} value={topic.title} onChange={(event) => setTopic({ ...topic, title: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manage-topic-entity-scope">参榜实体类别</Label>
                <Input id="manage-topic-entity-scope" maxLength={160} value={topic.entityScope} onChange={(event) => setTopic({ ...topic, entityScope: event.target.value })} placeholder="例如：电影" />
                <p className="text-xs text-muted-foreground">用于自动查找参榜对象，不是对外展示的完整话题名称。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manage-topic-kind">榜单类型</Label>
                <select id="manage-topic-kind" className={selectClass} value={topic.kind} onChange={(event) => {
                  if (isTopicKindValue(event.target.value)) setTopic({ ...topic, kind: event.target.value });
                }}>
                  {TOPIC_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">{TOPIC_KIND_OPTIONS.find((option) => option.value === topic.kind)?.hint}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manage-topic-locale">语言地区（只读）</Label>
                <Input id="manage-topic-locale" value={topic.locale} readOnly />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={saving} onClick={() => void saveTopic()}>
                {saving ? "保存中…" : "保存修改"}
              </Button>
              <Link href={topicsAdminPath(topic.slug)} className="text-sm text-primary underline-offset-4 hover:underline">
                返回该话题的版本页面
              </Link>
              <span className="text-xs text-muted-foreground">topicId={topic.id}</span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <AdminFooterNav />
    </div>
  );
}

export default function ManageTopicPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">加载…</div>}>
      <ManageTopicPageInner />
    </Suspense>
  );
}
