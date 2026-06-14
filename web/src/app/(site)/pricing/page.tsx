import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildSiteMetadata } from "@/lib/site-metadata";
import { SITE_HREF } from "@/lib/site-web-paths";

export const metadata: Metadata = buildSiteMetadata({
  title: "订阅方案",
  description: "Ranking 只读浏览免费；Pro 解锁更多话题筛选、个性化 watchlist 与导出能力（演示）。",
  path: "/pricing",
});

const TIERS = [
  {
    id: "free",
    name: "Free",
    price: "¥0",
    desc: "只读热榜、涨榜、搜索与实体曲线",
    features: ["全站只读 API", "热榜筛选与分页", "匿名设备偏好（watchlist）"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "演示",
    desc: "运营向能力预览（本仓库未接支付）",
    features: ["更高 API 配额", "个性化话题推荐", "时间线 AI 摘要（Console）", "优先快照通知"],
  },
] as const;

export default function PricingPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">订阅方案</h1>
        <p className="max-w-2xl text-muted-foreground">
          C 端默认免费只读。Pro 为产品演示档位，无需登录即可在本地设置设备偏好；正式支付与账号体系待接。
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {TIERS.map((tier) => (
          <Card key={tier.id} className={tier.id === "pro" ? "border-primary/40" : undefined}>
            <CardHeader>
              <CardTitle>{tier.name}</CardTitle>
              <CardDescription>{tier.desc}</CardDescription>
              <p className="text-2xl font-semibold">{tier.price}</p>
            </CardHeader>
            <CardContent>
              <ul className="mb-4 space-y-1 text-sm text-muted-foreground">
                {tier.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              {tier.id === "free" ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={SITE_HREF.hot}>开始浏览</Link>
                </Button>
              ) : (
                <Button asChild size="sm">
                  <Link href={SITE_HREF.hot}>试用 Pro 功能</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
