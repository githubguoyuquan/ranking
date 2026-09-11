"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_HREF, topicsAdminPath } from "@/lib/admin-web-paths";
import { adminTopicsUrl } from "@/lib/backend-api-urls";
import { adminApiHeaders } from "@/lib/query-http";

type TopicListItem = {
  id: string;
  slug: string;
  title: string;
  entityScope: string | null;
  kind: string;
  locale: string;
  isOnline: boolean;
  versionCount: number;
  updatedAt: string;
};

export function TopicListPanel() {
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<TopicListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionSlug, setActionSlug] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function loadTopics(q = query) {
    setLoading(true);
    setError("");
    try {
      const url = new URL(adminTopicsUrl());
      if (q.trim()) url.searchParams.set("q", q.trim());
      url.searchParams.set("limit", "200");
      const response = await fetch(url, {
        headers: adminApiHeaders(),
        cache: "no-store",
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`查询失败（HTTP ${response.status}）：${text}`);
      const body = JSON.parse(text) as { topics?: TopicListItem[] };
      setTopics(Array.isArray(body.topics) ? body.topics : []);
    } catch (cause) {
      setTopics([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function changeOnline(topic: TopicListItem, isOnline: boolean) {
    setActionSlug(topic.slug);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(
        `${adminTopicsUrl()}/${encodeURIComponent(topic.slug)}/status`,
        {
          method: "PATCH",
          headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ isOnline }),
        },
      );
      if (!response.ok) throw new Error(`操作失败（HTTP ${response.status}）`);
      setFeedback(`话题“${topic.title}”已${isOnline ? "上线" : "下线"}。`);
      await loadTopics();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionSlug(null);
    }
  }

  async function deleteTopic(topic: TopicListItem) {
    if (!window.confirm(`确认删除“${topic.title}”吗？\n\n删除后会隐藏话题，但历史版本和快照会保留。`)) return;
    setActionSlug(topic.slug);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(
        `${adminTopicsUrl()}/${encodeURIComponent(topic.slug)}`,
        { method: "DELETE", headers: adminApiHeaders() },
      );
      if (!response.ok) throw new Error(`删除失败（HTTP ${response.status}）`);
      setFeedback(`话题“${topic.title}”已删除。`);
      await loadTopics();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionSlug(null);
    }
  }

  useEffect(() => {
    void loadTopics("");
    // 首次进入页面加载一次，后续由运营主动搜索。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">话题管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            先选择话题，再管理参榜对象、版本和榜单结果。
          </p>
        </div>
        <Button asChild>
          <Link href={ADMIN_HREF.topicsNew}>新建话题</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">全部话题</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="topic-list-query">搜索话题</Label>
              <Input
                id="topic-list-query"
                maxLength={160}
                placeholder="输入话题名称、内部标识或实体类别"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !loading) void loadTopics();
                }}
              />
            </div>
            <Button type="button" disabled={loading} onClick={() => void loadTopics()}>
              {loading ? "查询中…" : "查询"}
            </Button>
          </div>

          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          {feedback ? <p className="text-sm text-emerald-700" role="status">{feedback}</p> : null}
          {!loading && !error && topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有找到话题。</p>
          ) : null}

          {topics.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2">话题</th>
                    <th scope="col" className="px-3 py-2">参榜实体类别</th>
                    <th scope="col" className="px-3 py-2">榜单类型</th>
                    <th scope="col" className="px-3 py-2">状态</th>
                    <th scope="col" className="px-3 py-2">版本数</th>
                    <th scope="col" className="px-3 py-2">更新时间</th>
                    <th scope="col" className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {topics.map((topic) => (
                    <tr key={topic.id} className="border-t">
                      <th scope="row" className="px-3 py-3 text-left font-normal">
                        <p className="font-medium text-foreground">{topic.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">{topic.slug}</p>
                      </th>
                      <td className="px-3 py-3">{topic.entityScope || "—"}</td>
                      <td className="px-3 py-3">{topic.kind}</td>
                      <td className="px-3 py-3">
                        <span className={topic.isOnline ? "text-emerald-700" : "text-muted-foreground"}>
                          {topic.isOnline ? "已上线" : "已下线"}
                        </span>
                      </td>
                      <td className="px-3 py-3">{topic.versionCount}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {new Date(topic.updatedAt).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          <Link href={topicsAdminPath(topic.slug)} className="self-center text-primary underline-offset-4 hover:underline">
                            进入话题
                          </Link>
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            disabled={actionSlug === topic.slug}
                            onClick={() => void changeOnline(topic, !topic.isOnline)}
                          >
                            {topic.isOnline ? "下线" : "上线"}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="destructive"
                            disabled={actionSlug === topic.slug}
                            onClick={() => void deleteTopic(topic)}
                          >
                            删除
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AdminFooterNav />
    </div>
  );
}
