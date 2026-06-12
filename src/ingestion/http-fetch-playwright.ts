import { createHash } from 'crypto';
import { chromium } from 'playwright';
import {
  buildTextPreview,
  crawlMaxBytes,
  crawlTimeoutMs,
  crawlUrlViolation,
  normalizeCrawlProxyUrl,
  textPreviewMaxChars,
  type FetchCrawlOptions,
  type FetchCrawlResult,
} from './http-fetch';
import {
  crawlDomFeaturesEnabled,
  extractDomFeatures,
} from './crawl-dom-extract';
import { extractSameHostLinks } from './crawl-link-extract';
import { pickCrawlUserAgent } from './crawl-fetch-retry';

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 使用无头 Chromium 渲染后再取 HTML / innerText；需 `playwright` 与浏览器缓存（`npx playwright install chromium`）。 */
export async function fetchUrlForCrawlPlaywright(
  urlStr: string,
  opts?: FetchCrawlOptions,
): Promise<FetchCrawlResult> {
  const viol = crawlUrlViolation(urlStr);
  if (viol) {
    return { ok: false, bytes: 0, error: viol };
  }

  const max = crawlMaxBytes();
  const timeout = crawlTimeoutMs();
  let browser;
  const proxyRaw =
    normalizeCrawlProxyUrl(opts?.proxyUrl) ??
    (opts?.globalProxyFallback !== false
      ? normalizeCrawlProxyUrl(process.env.CRAWL_HTTP_PROXY)
      : undefined);

  try {
    browser = await chromium.launch({ headless: true });
    const ua = opts?.userAgent ?? pickCrawlUserAgent(urlStr);
    const ctx = await browser.newContext({
      userAgent: ua,
      ...(proxyRaw ? { proxy: { server: proxyRaw } } : {}),
    });
    const page = await ctx.newPage();
    const res = await page.goto(urlStr, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    const statusCode = res?.status() ?? 200;
    if (!res?.ok()) {
      await ctx.close();
      return {
        ok: false,
        statusCode,
        bytes: 0,
        error: `HTTP ${statusCode}`,
      };
    }

    const html = await page.content();
    const buf = Buffer.from(html, 'utf8');
    if (buf.length > max) {
      await ctx.close();
      return {
        ok: false,
        statusCode,
        bytes: buf.length,
        error: `response larger than ${max} bytes`,
      };
    }

    let textPreview: string | null = null;
    try {
      const inner = await page.evaluate(() => document.body?.innerText ?? '');
      const t = inner.replace(/\s+/g, ' ').trim();
      if (t) {
        const lim = textPreviewMaxChars();
        textPreview = t.length <= lim ? t : `${t.slice(0, lim)}…`;
      }
    } catch {
      textPreview = buildTextPreview('text/html', buf);
    }
    if (!textPreview) {
      textPreview = buildTextPreview('text/html', buf);
    }

    let pageTitle: string | null = null;
    try {
      const t = (await page.title()).trim().replace(/\s+/g, ' ');
      if (t) {
        pageTitle = t.length <= 512 ? t : `${t.slice(0, 512)}…`;
      }
    } catch {
      pageTitle = null;
    }

    await ctx.close();

    const domFeatures =
      crawlDomFeaturesEnabled() ? extractDomFeatures('text/html', buf) : null;
    let discoveredLinks: string[] | undefined;
    if (opts?.linkScopeHost && opts.linkExtractMax && opts.linkExtractMax > 0) {
      discoveredLinks = extractSameHostLinks(
        html,
        urlStr,
        opts.linkScopeHost,
        opts.linkExtractMax,
      );
    }

    return {
      ok: true,
      statusCode,
      bytes: buf.length,
      contentHash: sha256Hex(buf),
      mimeType: 'text/html',
      textPreview,
      pageTitle,
      domFeatures,
      discoveredLinks,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, bytes: 0, error: msg };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
