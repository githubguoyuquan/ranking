/** 从抓取页文本/HTML 摘录中抽取结构化排行信号 */
export type CrawlExtractedSignal = {
  metricKey: string;
  value: number;
  unit?: string;
};

const SIGNAL_PATTERNS: Array<{
  metricKey: string;
  re: RegExp;
  unit?: string;
  scale?: (n: number) => number;
}> = [
  {
    metricKey: 'streams',
    re: /(?:streams?|plays?|listeners?|monthly\s+listeners)[:\s]*([\d,.]+)\s*([kmb])?/gi,
    unit: 'count',
  },
  {
    metricKey: 'social',
    re: /(?:followers?|subscribers?|fans?)[:\s]*([\d,.]+)\s*([kmb])?/gi,
    unit: 'count',
  },
  {
    metricKey: 'mentions',
    re: /(?:mentions?|posts?|tweets?|articles?)[:\s]*([\d,.]+)\s*([kmb])?/gi,
    unit: 'count',
  },
  {
    metricKey: 'news',
    re: /(?:news\s+coverage|press\s+mentions?|articles?)[:\s]*([\d,.]+)\s*([kmb])?/gi,
    unit: 'count',
  },
];

function parseScaledNumber(raw: string, suffix?: string): number | null {
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  const s = (suffix ?? '').toLowerCase();
  if (s === 'k') return n * 1_000;
  if (s === 'm') return n * 1_000_000;
  if (s === 'b') return n * 1_000_000_000;
  return n;
}

/** 从合并文本中抽取信号（每种 metricKey 取首个匹配） */
export function extractSignalsFromCrawlText(text: string): CrawlExtractedSignal[] {
  const hay = text.slice(0, 120_000);
  const out: CrawlExtractedSignal[] = [];
  const seen = new Set<string>();

  for (const pat of SIGNAL_PATTERNS) {
    pat.re.lastIndex = 0;
    const m = pat.re.exec(hay);
    if (!m) continue;
    const value = parseScaledNumber(m[1], m[2]);
    if (value == null || seen.has(pat.metricKey)) continue;
    seen.add(pat.metricKey);
    out.push({
      metricKey: pat.metricKey,
      value,
      ...(pat.unit ? { unit: pat.unit } : {}),
    });
  }

  return out;
}

export function crawlSignalExtractEnabled(): boolean {
  return process.env.CRAWL_SIGNAL_EXTRACT !== 'false';
}
