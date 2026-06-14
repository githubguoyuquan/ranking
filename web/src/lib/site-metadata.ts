import type { Metadata } from "next";

const DEFAULT_DESCRIPTION =
  "AI 驱动的全球动态排行榜与热点趋势 — 只读浏览话题热榜、实体排名与涨榜速递。";

export function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:3001"
  );
}

export function buildSiteMetadata(opts: {
  title: string;
  description?: string;
  path: string;
}): Metadata {
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  const url = `${siteBaseUrl()}${opts.path.startsWith("/") ? opts.path : `/${opts.path}`}`;

  return {
    title: opts.title,
    description,
    openGraph: {
      title: opts.title,
      description,
      url,
      siteName: "Ranking",
      type: "website",
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description,
    },
    alternates: {
      canonical: url,
    },
  };
}
