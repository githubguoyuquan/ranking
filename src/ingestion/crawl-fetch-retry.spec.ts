import { describe, expect, it, vi } from 'vitest';
import { fetchCrawlWithRetry } from './crawl-fetch-retry';

describe('fetchCrawlWithRetry', () => {
  it('retries on 503 then succeeds', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, bytes: 0, statusCode: 503, error: 'HTTP 503' })
      .mockResolvedValueOnce({
        ok: true,
        statusCode: 200,
        bytes: 10,
        contentHash: 'abc',
        mimeType: 'text/html',
        textPreview: 'hi',
        pageTitle: 'T',
      });

    const out = await fetchCrawlWithRetry(fn);
    expect(out.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
