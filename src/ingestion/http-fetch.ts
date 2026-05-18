import { createHash } from 'crypto';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  'metadata.google.internal',
]);

export function crawlTimeoutMs(): number {
  const n = Number(process.env.CRAWL_FETCH_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 3000 && n <= 120_000 ? n : DEFAULT_TIMEOUT_MS;
}

export function crawlMaxBytes(): number {
  const n = Number(process.env.CRAWL_MAX_RESPONSE_BYTES);
  return Number.isFinite(n) && n >= 10_000 && n <= 20_000_000 ? n : DEFAULT_MAX_BYTES;
}

export function textPreviewMaxChars(): number {
  const n = Number(process.env.CRAWL_TEXT_PREVIEW_CHARS);
  return Number.isFinite(n) && n >= 500 && n <= 500_000 ? n : 8000;
}

/**
 * 基础 SSRF 防护：仅 http(s)，拦常见内网/本地主机名（非完备，生产应配合出口代理与解析审计）。
 * @returns 违反规则时的说明文案；通过则 `undefined`
 */
export function crawlUrlViolation(urlStr: string): string | undefined {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return 'invalid URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return 'only http(s) allowed';
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.localhost')) {
    return 'blocked hostname';
  }
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) {
    return 'blocked private/link-local host';
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return 'blocked private host';
  }
  return undefined;
}

export type FetchCrawlResult =
  | {
      ok: true;
      statusCode: number;
      bytes: number;
      contentHash: string;
      mimeType: string | null;
      textPreview: string | null;
      pageTitle: string | null;
    }
  | {
      ok: false;
      statusCode?: number;
      bytes: number;
      error: string;
    };

const UA =
  process.env.CRAWL_USER_AGENT ??
  'RankingPlatformCrawler/0.1 (+https://github.com/example/ranking; research)';

export function normalizeCrawlProxyUrl(raw: string | null | undefined): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return undefined;
    }
    return u.toString();
  } catch {
    return undefined;
  }
}

const PAGE_TITLE_MAX_CHARS = 512;

/** 从 HTML/XML 缓冲提取 `<title>` 纯文本（截断至 `PAGE_TITLE_MAX_CHARS`） */
export function extractPageTitle(mimeType: string | null, buf: Buffer): string | null {
  if (buf.length === 0) return null;
  const m = (mimeType ?? '').toLowerCase();
  if (m.includes('json') || m.startsWith('image/') || m.startsWith('video/')) return null;
  const maybeMarkup =
    m.includes('html') || m.includes('xml') || m === 'application/xhtml+xml';
  if (!maybeMarkup && !m.startsWith('text/')) return null;

  const cap = Math.min(buf.length, 500_000);
  const sample = buf.toString('utf8', 0, cap);
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(sample);
  if (!match) return null;
  let t = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  t = decodeBasicHtmlEntities(t);
  if (!t) return null;
  return t.length <= PAGE_TITLE_MAX_CHARS ? t : `${t.slice(0, PAGE_TITLE_MAX_CHARS)}…`;
}

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return Number.isFinite(c) && c >= 32 && c < 0x110000 ? String.fromCodePoint(c) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const c = parseInt(h, 16);
      return Number.isFinite(c) && c >= 32 && c < 0x110000 ? String.fromCodePoint(c) : _;
    });
}

export async function fetchUrlForCrawl(
  urlStr: string,
  opts?: { proxyUrl?: string | null; globalProxyFallback?: boolean },
): Promise<FetchCrawlResult> {
  const viol = crawlUrlViolation(urlStr);
  if (viol) {
    return { ok: false, bytes: 0, error: viol };
  }
  const max = crawlMaxBytes();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), crawlTimeoutMs());
  let bytes = 0;
  const proxyRaw =
    normalizeCrawlProxyUrl(opts?.proxyUrl) ??
    (opts?.globalProxyFallback !== false
      ? normalizeCrawlProxyUrl(process.env.CRAWL_HTTP_PROXY)
      : undefined);
  const dispatcher = proxyRaw ? new ProxyAgent(proxyRaw) : undefined;
  try {
    const res = await undiciFetch(urlStr, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      dispatcher,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': UA,
      },
    });

    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        bytes: 0,
        error: `HTTP ${res.status}`,
      };
    }

    const mimeHeader = res.headers.get('content-type');
    const mimeType = mimeHeader?.split(';')[0]?.trim() || null;

    const buf: Buffer[] = [];
    const body = res.body;
    if (!body) {
      return {
        ok: true,
        statusCode: res.status,
        bytes: 0,
        contentHash: sha256Hex(Buffer.alloc(0)),
        mimeType,
        textPreview: null,
        pageTitle: null,
      };
    }

    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        if (bytes > max) {
          await reader.cancel();
          return {
            ok: false,
            statusCode: res.status,
            bytes,
            error: `response larger than ${max} bytes`,
          };
        }
        buf.push(Buffer.from(value));
      }
    }

    const combined = Buffer.concat(buf);
    const textPreview = buildTextPreview(mimeType, combined);
    const pageTitle = extractPageTitle(mimeType, combined);
    return {
      ok: true,
      statusCode: res.status,
      bytes: combined.length,
      contentHash: sha256Hex(combined),
      mimeType,
      textPreview,
      pageTitle,
    };
  } catch (e) {
    const msg =
      e instanceof Error ? e.name === 'AbortError' ? 'timeout' : e.message : String(e);
    return { ok: false, bytes, error: msg };
  } finally {
    clearTimeout(t);
  }
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 轻量 HTML/XML 去标签，仅用于 preview（不保证与浏览器一致） */
export function buildTextPreview(mimeType: string | null, buf: Buffer): string | null {
  if (buf.length === 0) return null;
  const m = (mimeType ?? '').toLowerCase();
  const textual =
    m.startsWith('text/') ||
    m.includes('json') ||
    m.includes('xml') ||
    m.includes('html') ||
    m.includes('javascript') ||
    m === 'application/ld+json';
  if (!textual) return null;

  let s = buf.toString('utf8');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const max = textPreviewMaxChars();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
