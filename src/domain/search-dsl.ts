/** 自 query 字符串解析出的结构化过滤（剩余文本为自由检索词） */
export type SearchDslFilters = {
  type?: string;
  topic?: string;
  sourceId?: string;
  status?: string;
  since?: Date;
  until?: Date;
};

export type SearchDslParseResult = {
  text: string;
  filters: SearchDslFilters;
  /** 自 q 内联解析出的键（不含 query 显式参数） */
  inlineKeys: string[];
};

const FILTER_RE =
  /\b(type|topic|source|status|since|until):(\S+)/gi;

export type SearchDslExplicit = {
  type?: string;
  topic?: string;
  sourceId?: string;
  status?: string;
  since?: string;
  until?: string;
};

export function parseRelativeOrIsoTime(raw: string, now = new Date()): Date | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const rel = /^(\d+)([dhw])$/i.exec(s);
  if (rel) {
    const n = Number.parseInt(rel[1]!, 10);
    if (!Number.isFinite(n) || n < 0) return undefined;
    const unit = rel[2]!.toLowerCase();
    const ms =
      unit === 'h'
        ? n * 3_600_000
        : unit === 'w'
          ? n * 7 * 86_400_000
          : n * 86_400_000;
    return new Date(now.getTime() - ms);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseSearchDsl(
  query: string,
  explicit: SearchDslExplicit = {},
  now = new Date(),
): SearchDslParseResult {
  const filters: SearchDslFilters = {};
  const inlineKeys: string[] = [];
  let text = query.trim();

  for (const m of text.matchAll(FILTER_RE)) {
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    inlineKeys.push(key);
    switch (key) {
      case 'type':
        filters.type = val;
        break;
      case 'topic':
        filters.topic = val;
        break;
      case 'source':
        filters.sourceId = val;
        break;
      case 'status':
        filters.status = val;
        break;
      case 'since': {
        const d = parseRelativeOrIsoTime(val, now);
        if (d) filters.since = d;
        break;
      }
      case 'until': {
        const d = parseRelativeOrIsoTime(val, now);
        if (d) filters.until = d;
        break;
      }
      default:
        break;
    }
  }

  text = text.replace(FILTER_RE, ' ').replace(/\s+/g, ' ').trim();

  if (explicit.type?.trim()) filters.type = explicit.type.trim();
  if (explicit.topic?.trim()) filters.topic = explicit.topic.trim();
  if (explicit.sourceId?.trim()) filters.sourceId = explicit.sourceId.trim();
  if (explicit.status?.trim()) filters.status = explicit.status.trim();
  if (explicit.since?.trim()) {
    const d = parseRelativeOrIsoTime(explicit.since.trim(), now);
    if (d) filters.since = d;
  }
  if (explicit.until?.trim()) {
    const d = parseRelativeOrIsoTime(explicit.until.trim(), now);
    if (d) filters.until = d;
  }

  return { text, filters, inlineKeys };
}
