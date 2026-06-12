import { urlFingerprint } from './crawl-job';

const SKIP_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|woff2?|ttf|eot|mp4|mp3|zip|pdf)(\?|$)/i;

/** 从 HTML 提取同站可跟进链接（绝对化 + 去 fragment + 去 tracking 参数与 fingerprint 一致） */
export function extractSameHostLinks(
  html: string,
  pageUrl: string,
  scopeHost: string,
  max: number,
): string[] {
  if (max <= 0) return [];
  let page: URL;
  const host = scopeHost.toLowerCase();
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  if (!host) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const re = /<a\b[^>]*\shref=["']([^"'#][^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('javascript:')) continue;
    let abs: URL;
    try {
      abs = new URL(raw, page);
    } catch {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    if (abs.hostname.toLowerCase() !== host) continue;
    if (SKIP_EXTENSIONS.test(abs.pathname)) continue;
    abs.hash = '';
    const fp = urlFingerprint(abs.toString());
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(abs.toString());
  }
  return out;
}

export function crawlFollowLinksEnabled(): boolean {
  return process.env.CRAWL_FOLLOW_LINKS === 'true';
}

export function crawlFollowLinksMaxPerTask(): number {
  const n = Number(process.env.CRAWL_FOLLOW_LINKS_MAX);
  return Number.isFinite(n) && n >= 1 && n <= 500 ? Math.floor(n) : 20;
}

export function resolveLinkScopeHost(sourceBaseUrl: string, pageUrl: string): string {
  try {
    return new URL(sourceBaseUrl).hostname.toLowerCase();
  } catch {
    try {
      return new URL(pageUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
}
