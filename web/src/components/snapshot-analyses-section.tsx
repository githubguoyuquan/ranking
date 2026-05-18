import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  detailJsonUsedChainContext,
  formatAgentKind,
  truncateSummary,
} from "@/lib/snapshot-analysis-display";
import type { ReactNode } from "react";

export type SnapshotAnalysisListItem = {
  id: string;
  agent: string;
  summary: string;
  confidence?: number;
  createdAt: string;
  detailJson?: unknown;
};

export type SnapshotAnalysesSectionProps = {
  rows: SnapshotAnalysisListItem[];
  analysesJsonUrl: string;
  loadError?: string | null;
  filterSlot?: ReactNode;
  /** `GET …/analyses` 的 `total`（分页） */
  analysesTotal?: number | null;
};

const SUMMARY_PREVIEW = 160;

export function SnapshotAnalysesSection(props: SnapshotAnalysesSectionProps) {
  const { rows, analysesJsonUrl, loadError, filterSlot, analysesTotal } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">已有 AiAnalysis</CardTitle>
        <CardDescription>
          每条记录的 <code className="rounded bg-muted px-1 text-xs">agent</code> 与{" "}
          <code className="rounded bg-muted px-1 text-xs">detailJson.agentKind</code>{" "}
          类型、<code className="rounded bg-muted px-1 text-xs">usedChainContext</code>；API 支持{" "}
          <code className="rounded bg-muted px-1 text-xs">?agentKind=</code>、
          <code className="rounded bg-muted px-1 text-xs">?agent=</code>、
          <code className="rounded bg-muted px-1 text-xs">limit</code>/
          <code className="rounded bg-muted px-1 text-xs">offset</code>；完整 JSON 可
          <a
            href={analysesJsonUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-1 text-primary underline-offset-4 hover:underline"
          >
            新标签打开列表接口
          </a>
          。
          {analysesTotal != null && analysesTotal > 0 ? (
            <span className="mt-1 block text-muted-foreground">
              命中 {analysesTotal} 条
              {rows.length < analysesTotal
                ? `，本表最多展示 ${rows.length} 条（见 limit）。`
                : "。"}
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {filterSlot ? <div className="mb-3">{filterSlot}</div> : null}
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚无简报记录。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    时间
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    类型
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    agent
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    链式
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    摘要预览
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    id
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {formatAgentKind(r.detailJson, r.agent)}
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-xs">
                      {r.agent || "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {detailJsonUsedChainContext(r.detailJson) ? "是" : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {truncateSummary(r.summary ?? "", SUMMARY_PREVIEW)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {r.id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
