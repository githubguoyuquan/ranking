"use client";

import { useRouter } from "next/navigation";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { TopicCreatePanel } from "@/components/topic-create-panel";
import { TopicModuleNav } from "@/components/topic-module-nav";
import { topicsAdminPath } from "@/lib/admin-web-paths";

export default function NewTopicPage() {
  const router = useRouter();

  return (
    <div className="w-full max-w-none space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">新建话题</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          这里只创建话题并启动参榜对象自动查找；创建成功后进入“话题版本”继续新建版本。
        </p>
      </div>

      <TopicModuleNav current="new" />

      <TopicCreatePanel
        mode="topic"
        currentTopic={null}
        existingVersions={[]}
        onTopicCreated={(created) => {
          router.push(topicsAdminPath(created.slug));
        }}
        onVersionCreated={() => undefined}
      />

      <AdminFooterNav />
    </div>
  );
}
