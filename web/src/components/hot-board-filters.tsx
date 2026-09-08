"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { siteHotPath } from "@/lib/site-web-paths";

const TOPIC_KINDS = [
  { value: "", label: "全部类型" },
  { value: "OBJECTIVE", label: "客观" },
  { value: "SEMI_OBJECTIVE", label: "半客观" },
  { value: "SUBJECTIVE_TREND", label: "主观趋势" },
] as const;

export function HotBoardFilters({
  topicQuery,
  topicKind,
  timeWindow,
}: {
  topicQuery?: string;
  topicKind?: string;
  timeWindow?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(topicQuery ?? "");
  const [kind, setKind] = useState(topicKind ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    router.push(
      siteHotPath({
        timeWindow: timeWindow || undefined,
        topicQuery: q.trim() || undefined,
        topicKind: kind || undefined,
      }),
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] flex-1">
        <label className="mb-1 block text-sm text-muted-foreground">话题筛选</label>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="slug 或标题关键词"
          maxLength={80}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm text-muted-foreground">类型</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="h-10 rounded-lg border border-input bg-background px-3 text-base"
        >
          {TOPIC_KINDS.map((k) => (
            <option key={k.value || "all"} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" size="sm">
        筛选
      </Button>
      {(topicQuery || topicKind) && (
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href={siteHotPath(timeWindow ? { timeWindow } : undefined)}>清除</Link>
        </Button>
      )}
    </form>
  );
}

export function HotBoardPagination({
  offset,
  hasMore,
  nextOffset,
  timeWindow,
  topicQuery,
  topicKind,
  topicsLimit,
}: {
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  timeWindow?: string;
  topicQuery?: string;
  topicKind?: string;
  topicsLimit: string;
}) {
  if (!hasMore && offset <= 0) return null;

  const prevOffset = Math.max(0, offset - Number(topicsLimit || 12));

  return (
    <nav className="flex flex-wrap items-center justify-center gap-2 pt-2" aria-label="分页">
      {offset > 0 ? (
        <Button asChild variant="outline" size="sm">
          <Link
            href={siteHotPath({
              timeWindow: timeWindow || undefined,
              topicQuery: topicQuery || undefined,
              topicKind: topicKind || undefined,
              topicsLimit,
              offset: String(prevOffset),
            })}
          >
            上一页
          </Link>
        </Button>
      ) : null}
      {hasMore && nextOffset != null ? (
        <Button asChild size="sm">
          <Link
            href={siteHotPath({
              timeWindow: timeWindow || undefined,
              topicQuery: topicQuery || undefined,
              topicKind: topicKind || undefined,
              topicsLimit,
              offset: String(nextOffset),
            })}
          >
            下一页
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}
