import type { FetchCrawlResult } from './http-fetch';

const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);

export function crawlFetchMaxRetries(): number {
  const n = Number(process.env.CRAWL_FETCH_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.floor(n) : 2;
}

export function pickCrawlUserAgent(seed?: string): string {
  const poolRaw = process.env.CRAWL_USER_AGENT_POOL?.trim();
  if (poolRaw) {
    const pool = poolRaw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (pool.length > 0) {
      if (!seed) return pool[Math.floor(Math.random() * pool.length)]!;
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      return pool[h % pool.length]!;
    }
  }
  return (
    process.env.CRAWL_USER_AGENT ??
    'RankingPlatformCrawler/0.1 (+https://github.com/example/ranking; research)'
  );
}

function isRetryable(result: FetchCrawlResult): boolean {
  if (result.ok) return false;
  if (result.statusCode != null && RETRYABLE_HTTP.has(result.statusCode)) return true;
  const err = result.error.toLowerCase();
  return err.includes('timeout') || err.includes('econnreset') || err.includes('socket');
}

function retryDelayMs(attempt: number): number {
  const base = Number(process.env.CRAWL_FETCH_RETRY_BASE_MS);
  const ms = Number.isFinite(base) && base >= 100 ? base : 800;
  return ms * 2 ** attempt;
}

export async function fetchCrawlWithRetry(
  fetchOnce: () => Promise<FetchCrawlResult>,
): Promise<FetchCrawlResult> {
  const maxRetries = crawlFetchMaxRetries();
  let last: FetchCrawlResult = { ok: false, bytes: 0, error: 'no attempt' };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await fetchOnce();
    if (!isRetryable(last) || attempt >= maxRetries) return last;
    await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
  }
  return last;
}
