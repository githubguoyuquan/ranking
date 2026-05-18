import { parseScoreBreakdownEntries } from "@/lib/snapshot-score-breakdown";

export function SnapshotScoreBreakdownCell({ raw }: { raw: unknown }) {
  const entries = parseScoreBreakdownEntries(raw);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const preview = entries
    .slice(0, 2)
    .map((e) => `${e.key} ${e.value.toFixed(3)}`)
    .join(" · ");
  return (
    <details className="text-left">
      <summary className="cursor-pointer text-xs text-primary underline-offset-2 hover:underline">
        {preview}
        {entries.length > 2 ? " …" : ""}
      </summary>
      <dl className="mt-1.5 max-w-[14rem] space-y-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px]">
        {entries.map((e) => (
          <div key={e.key} className="flex justify-between gap-2">
            <dt className="truncate text-muted-foreground" title={e.key}>
              {e.key}
            </dt>
            <dd className="shrink-0 font-mono tabular-nums text-foreground/90">
              {e.value.toFixed(4)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
