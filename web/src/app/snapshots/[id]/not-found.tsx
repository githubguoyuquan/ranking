import Link from "next/link";

export default function SnapshotNotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 pt-12 text-center">
      <h1 className="text-xl font-semibold">未找到快照</h1>
      <p className="text-sm text-muted-foreground">
        请检查 id 或先运行种子数据 / 排行任务。
      </p>
      <Link href="/" className="text-primary underline-offset-4 hover:underline">
        返回概览
      </Link>
    </div>
  );
}
