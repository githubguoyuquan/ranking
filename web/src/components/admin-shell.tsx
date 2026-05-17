import Link from "next/link";

const links = [
  { href: "/", label: "概览" },
  { href: "/seed", label: "演示数据" },
  { href: "/rankings/run", label: "运行排行" },
  { href: "/topics", label: "话题版本" },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border bg-card/40 p-4 backdrop-blur-sm">
        <div className="mb-6 font-semibold tracking-tight text-foreground">
          Ranking 管理台
        </div>
        <nav className="flex flex-col gap-0.5">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          API{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
            {process.env.NEXT_PUBLIC_API_URL ?? "localhost:3000"}
          </code>
          <br />
          前端默认端口{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">3001</code>
        </p>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
