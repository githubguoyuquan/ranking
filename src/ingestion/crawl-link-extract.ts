import { urlFingerprint } from './crawl-job';

const SKIP_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|woff2?|ttf|eot|mp4|mp3|zip|pdf)(\?|$)/i;

/** 从 HTML 提取允许 host 集合内的可跟进链接 */
export function extractFollowLinks(
  html: string,
  pageUrl: string,
  allowHosts: ReadonlySet<string>,
  max: number,
): string[] {
  if (max <= 0 || allowHosts.size === 0) return [];
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }

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
    if (!allowHosts.has(abs.hostname.toLowerCase())) continue;
    if (SKIP_EXTENSIONS.test(abs.pathname)) continue;
    abs.hash = '';
    const fp = urlFingerprint(abs.toString());
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(abs.toString());
  }
  return out;
}

/** @deprecated 使用 `extractFollowLinks` */
export function extractSameHostLinks(
  html: string,
  pageUrl: string,
  scopeHost: string,
  max: number,
): string[] {
  const host = scopeHost.toLowerCase();
  if (!host) return [];
  return extractFollowLinks(html, pageUrl, new Set([host]), max);
}

export function crawlFollowLinksEnabled(): boolean {
  return process.env.CRAWL_FOLLOW_LINKS === 'true';
}

export function crawlFollowLinksMaxPerTask(): number {
  const n = Number(process.env.CRAWL_FOLLOW_LINKS_MAX);
  return Number.isFinite(n) && n >= 1 && n <= 500 ? Math.floor(n) : 20;
}

/** seed 为 depth 0；跟进链接 depth+1，超过则不入队 */
export function crawlFollowLinksMaxDepth(): number {
  const n = Number(process.env.CRAWL_FOLLOW_LINKS_MAX_DEPTH);
  return Number.isFinite(n) && n >= 0 && n <= 20 ? Math.floor(n) : 3;
}

export function crawlLinkExtractMaxPerPage(): number {
  const n = Number(process.env.CRAWL_LINK_EXTRACT_MAX);
  return Number.isFinite(n) && n >= 1 && n <= 200 ? Math.floor(n) : 40;
}

/** 逗号分隔额外允许 host；始终包含 source/seed 的 scope host */
export function crawlLinkAllowHostsList(): string[] {
  const raw = process.env.CRAWL_LINK_ALLOW_HOSTS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0 && h.length <= 253);
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

export function resolveLinkAllowHosts(
  sourceBaseUrl: string,
  pageUrl: string,
): Set<string> {
  const hosts = new Set<string>();
  const scope = resolveLinkScopeHost(sourceBaseUrl, pageUrl);
  if (scope) hosts.add(scope);
  for (const h of crawlLinkAllowHostsList()) {
    hosts.add(h);
  }
  return hosts;
}

export function isLinkHostAllowed(urlStr: string, allowHosts: ReadonlySet<string>): boolean {
  try {
    return allowHosts.has(new URL(urlStr).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function crawlLinkPolicySnapshot(): {
  followLinks: boolean;
  maxDepth: number;
  maxUrlsPerTask: number;
  respectRobots: boolean;
  allowHosts: string[];
  extractMaxPerPage: number;
} {
  return {
    followLinks: crawlFollowLinksEnabled(),
    maxDepth: crawlFollowLinksMaxDepth(),
    maxUrlsPerTask: crawlFollowLinksMaxPerTask(),
    respectRobots: process.env.CRAWL_RESPECT_ROBOTS === 'true',
    allowHosts: crawlLinkAllowHostsList(),
    extractMaxPerPage: crawlLinkExtractMaxPerPage(),
  };
}
