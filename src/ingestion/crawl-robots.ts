export type RobotsRules = {
  disallow: string[];
  allow: string[];
};

const DEFAULT_UA = '*';

/** 解析 robots.txt（User-agent 块；优先精确 UA，否则 `*`） */
export function parseRobotsTxt(text: string, userAgent = DEFAULT_UA): RobotsRules {
  const lines = text.split(/\r?\n/);
  const blocks: Array<{ agents: string[]; rules: RobotsRules }> = [];
  let currentAgents: string[] = [];
  let current: RobotsRules = { disallow: [], allow: [] };

  const flush = () => {
    if (currentAgents.length === 0) return;
    blocks.push({
      agents: [...currentAgents],
      rules: {
        disallow: [...current.disallow],
        allow: [...current.allow],
      },
    });
    currentAgents = [];
    current = { disallow: [], allow: [] };
  };

  for (const raw of lines) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (currentAgents.length > 0 && (current.disallow.length || current.allow.length)) {
        flush();
      }
      if (currentAgents.length === 0) currentAgents = [];
      currentAgents.push(val.toLowerCase());
    } else if (key === 'disallow' && val) {
      current.disallow.push(val);
    } else if (key === 'allow' && val) {
      current.allow.push(val);
    }
  }
  flush();

  const ua = userAgent.toLowerCase();
  let picked: RobotsRules | null = null;
  let star: RobotsRules | null = null;
  for (const b of blocks) {
    if (b.agents.includes(ua)) {
      picked = b.rules;
      break;
    }
    if (b.agents.includes(DEFAULT_UA)) star = b.rules;
  }
  return picked ?? star ?? { disallow: [], allow: [] };
}

/** 路径是否被 robots 允许（最长前缀匹配；Allow 可覆盖 Disallow） */
export function isPathAllowedByRobots(pathname: string, rules: RobotsRules): boolean {
  const path = pathname || '/';
  let bestDisallow = -1;
  let bestAllow = -1;

  for (const p of rules.disallow) {
    if (p === '') continue;
    if (path.startsWith(p) && p.length > bestDisallow) bestDisallow = p.length;
  }
  for (const p of rules.allow) {
    if (p === '') continue;
    if (path.startsWith(p) && p.length > bestAllow) bestAllow = p.length;
  }
  if (bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}

export function isUrlAllowedByRobots(urlStr: string, rules: RobotsRules): boolean {
  try {
    return isPathAllowedByRobots(new URL(urlStr).pathname, rules);
  } catch {
    return false;
  }
}

export type RobotsCache = Map<string, RobotsRules | null>;

export function crawlRespectRobotsEnabled(): boolean {
  return process.env.CRAWL_RESPECT_ROBOTS === 'true';
}

const ROBOTS_FETCH_MS = 8_000;

/** 拉取并缓存 host 级 robots.txt；失败视为无限制（null rules → 全允许） */
export async function loadRobotsRulesForHost(
  host: string,
  cache: RobotsCache,
  userAgent?: string,
): Promise<RobotsRules | null> {
  const key = host.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  let rules: RobotsRules | null = null;
  const ua = userAgent ?? 'RankingPlatformCrawler/0.2';
  for (const scheme of ['https', 'http'] as const) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ROBOTS_FETCH_MS);
      const res = await fetch(`${scheme}://${key}/robots.txt`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': ua },
        redirect: 'follow',
      });
      clearTimeout(t);
      if (res.ok) {
        rules = parseRobotsTxt(await res.text(), userAgent ?? DEFAULT_UA);
        break;
      }
    } catch {
      // try next scheme
    }
  }
  cache.set(key, rules);
  return rules;
}

export async function isCrawlUrlAllowedByRobots(
  urlStr: string,
  cache: RobotsCache,
  userAgent?: string,
): Promise<boolean> {
  let host: string;
  try {
    host = new URL(urlStr).hostname.toLowerCase();
  } catch {
    return false;
  }
  const rules = await loadRobotsRulesForHost(host, cache, userAgent);
  if (!rules) return true;
  return isUrlAllowedByRobots(urlStr, rules);
}
