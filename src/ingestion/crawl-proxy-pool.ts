import { normalizeCrawlProxyUrl } from './http-fetch';

let roundRobinIndex = 0;

/** 逗号或换行分隔的代理 URL 列表；`CRAWL_PROXY_POOL` */
export function crawlProxyPoolUrls(): string[] {
  const raw = process.env.CRAWL_PROXY_POOL?.trim();
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => normalizeCrawlProxyUrl(s))
    .filter((s): s is string => Boolean(s));
}

export function crawlProxyPoolEnabled(): boolean {
  return crawlProxyPoolUrls().length > 0;
}

/** 轮询选取下一代理；池为空时返回 undefined */
export function pickCrawlProxyFromPool(): string | undefined {
  const pool = crawlProxyPoolUrls();
  if (!pool.length) return undefined;
  const url = pool[roundRobinIndex % pool.length];
  roundRobinIndex += 1;
  return url;
}

export function crawlProxyPoolStatus(): { enabled: boolean; count: number } {
  const pool = crawlProxyPoolUrls();
  return { enabled: pool.length > 0, count: pool.length };
}
