import { createHash } from 'crypto';

export const CRAWL_QUEUE = 'crawl';
export const CRAWL_JOB_NAME = 'execute';

export type CrawlJobPayload = {
  crawlTaskId: string;
  sourceId: string;
  /** 用于更新 CrawlCheckpoint.crawlerName */
  crawlerName: string;
  cursor?: string;
  /** 桩任务：直接登记这些 URL（不发起真实 HTTP） */
  seedUrls?: string[];
};

export function urlFingerprint(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid']) {
      url.searchParams.delete(k);
    }
    return createHash('sha256').update(url.toString()).digest('hex');
  } catch {
    return createHash('sha256').update(rawUrl).digest('hex');
  }
}

export function buildCrawlJobId(p: CrawlJobPayload): string {
  const raw = [p.crawlTaskId, p.sourceId, p.cursor ?? '', ...(p.seedUrls ?? [])].join('|');
  return createHash('sha256').update(raw).digest('hex');
}
