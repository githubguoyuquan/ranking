import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { siteEntityPath, siteTopicPath } from "@/lib/site-web-paths";
import { cn } from "@/lib/utils";

export type HotBoardPreviewItem = {
  rank: number;
  rankChange?: number | null;
  entity?: { id?: string; canonicalName?: string | null };
};

export type HotBoardCardData = {
  topic: { slug: string; title: string; kind?: string };
  snapshot?: {
    id?: string;
    snapshotTime?: string;
    itemCount?: number;
    preview?: HotBoardPreviewItem[];
  };
  resolved?: { timeWindow?: string; topicVersion?: string };
};

export function HotBoardCard({ board }: { board: HotBoardCardData }) {
  const slug = board.topic.slug;
  const title = board.topic.title || slug;
  const preview = board.snapshot?.preview ?? [];

  return (
    <article className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <header className="mb-3 space-y-1">
        <Link
          href={siteTopicPath(slug)}
          className="text-lg font-semibold leading-tight hover:underline"
        >
          {title}
        </Link>
        <p className="text-xs text-muted-foreground">{slug}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {board.resolved?.timeWindow ? (
            <Badge variant="outline" className="text-xs">
              {board.resolved.timeWindow}
            </Badge>
          ) : null}
          {board.topic.kind ? (
            <Badge variant="secondary" className="text-xs">
              {board.topic.kind}
            </Badge>
          ) : null}
        </div>
      </header>

      {preview.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无排行数据</p>
      ) : (
        <ol className="flex-1 space-y-1.5">
          {preview.map((row) => (
            <li
              key={`${row.rank}-${row.entity?.id ?? row.entity?.canonicalName}`}
              className="flex items-center gap-2 text-sm"
            >
              <span className="w-5 text-center font-mono text-xs text-muted-foreground">
                {row.rank}
              </span>
              {row.entity?.id ? (
                <Link
                  href={siteEntityPath(String(row.entity.id))}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {row.entity.canonicalName ?? row.entity.id}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate">
                  {row.entity?.canonicalName ?? "—"}
                </span>
              )}
              {row.rankChange != null && row.rankChange !== 0 ? (
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    row.rankChange < 0 ? "text-emerald-600" : "text-amber-600",
                  )}
                >
                  {row.rankChange < 0 ? `↑${Math.abs(row.rankChange)}` : `↓${row.rankChange}`}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <footer className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        {board.snapshot?.snapshotTime ? (
          <span className="text-xs text-muted-foreground">
            {new Date(board.snapshot.snapshotTime).toLocaleString("zh-CN")}
          </span>
        ) : (
          <span />
        )}
        <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs">
          <Link href={siteTopicPath(slug)}>完整榜单 →</Link>
        </Button>
      </footer>
    </article>
  );
}
