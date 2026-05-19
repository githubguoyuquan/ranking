import { afterEach, describe, expect, it } from 'vitest';
import { crawlProxyPoolUrls, pickCrawlProxyFromPool } from './crawl-proxy-pool';

describe('crawl-proxy-pool', () => {
  afterEach(() => {
    delete process.env.CRAWL_PROXY_POOL;
  });

  it('parses comma-separated proxies', () => {
    process.env.CRAWL_PROXY_POOL = 'http://a:1,http://b:2';
    expect(crawlProxyPoolUrls()).toEqual(['http://a:1/', 'http://b:2/']);
  });

  it('round-robins picks', () => {
    process.env.CRAWL_PROXY_POOL = 'http://a:1,http://b:2';
    expect(pickCrawlProxyFromPool()).toBe('http://a:1/');
    expect(pickCrawlProxyFromPool()).toBe('http://b:2/');
    expect(pickCrawlProxyFromPool()).toBe('http://a:1/');
  });
});
