import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProxyAgent, fetch as proxyFetch } from 'undici';

export interface DiscoveredTopicEntity {
  externalId: string;
  name: string;
  description: string;
  type: string;
  sourceUrl: string;
}

export type EntityDiscoveryResult = {
  source: 'wikidata';
  strategy: string;
  entities: DiscoveredTopicEntity[];
  warning?: string;
};

type Scope = {
  label: string;
  qid: string;
};

const API_ENDPOINT = 'https://www.wikidata.org/w/api.php';
const QUERY_ENDPOINT = 'https://query.wikidata.org/sparql';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_048_576;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim();
}

function withoutRankingWords(title: string): string {
  return normalize(title)
    .replace(/(?:排行榜|排名榜|榜单|排名|榜|\s+rankings?|\s+leaderboards?|\s+list)\s*$/iu, '')
    .trim();
}

function languageCodes(locale: string): string[] {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith('zh')) {
    return normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-hant'
      ? ['zh-hant', 'zh', 'zh-hans', 'en']
      : ['zh-hans', 'zh', 'zh-hant', 'en'];
  }
  const primary = normalized.split('-')[0];
  return /^[a-z]{2,3}$/.test(primary) ? [...new Set([primary, 'en'])] : ['en'];
}

/** Retrieves real candidates only; it does not infer metrics or calculate a ranking. */
@Injectable()
export class TopicEntityDiscoveryService {
  async discover(args: { title: string; locale: string; count: number }): Promise<EntityDiscoveryResult> {
    if (!Number.isInteger(args.count) || args.count < 1 || args.count > 50) {
      throw new BadRequestException('自动填充实体数量必须为 1 到 50 的整数。');
    }
    const title = withoutRankingWords(args.title);
    if (!title || title.length > 200) {
      throw new BadRequestException('请填写明确的对象类别名称（不超过 200 字）。');
    }
    const languages = languageCodes(args.locale);
    const scope = await this.findExactClass(title, languages[0]);
    const query = this.buildQuery(scope, languages, Math.min(args.count * 3, 150));
    const url = new URL(QUERY_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('format', 'json');
    const result = await this.requestJson(url, 'application/sparql-results+json');
    const bindings = record(record(result)?.results)?.bindings;
    if (!Array.isArray(bindings)) {
      throw new ServiceUnavailableException('实体来源返回了无法识别的数据，请稍后重试。');
    }

    const seen = new Set<string>();
    const entities: DiscoveredTopicEntity[] = [];
    for (const binding of bindings) {
      const row = record(binding);
      const uri = record(row?.item)?.value;
      const label = record(row?.itemLabel)?.value;
      const description = record(row?.itemDescription)?.value;
      const qid = typeof uri === 'string'
        ? /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/.exec(uri)?.[1]
        : undefined;
      if (!qid || seen.has(qid) || typeof label !== 'string' || !label.trim() || /^Q\d+$/.test(label)) {
        continue;
      }
      seen.add(qid);
      entities.push({
        externalId: qid,
        name: label.trim().slice(0, 300),
        description: typeof description === 'string' ? description.trim().slice(0, 2000) : '',
        type: 'ENTITY',
        sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
      });
      if (entities.length === args.count) break;
    }
    if (entities.length === 0) {
      throw new BadRequestException(`“${args.title}”没有找到可核验的实体，请使用更明确的话题名称后重试。`);
    }
    return {
      source: 'wikidata',
      strategy: `完整名称精确匹配：${scope.label}（${scope.qid}）；按百科覆盖度选择候选`,
      entities,
      warning: '实体来自 Wikidata，按百科覆盖度选取，可能包含历史人物或历史对象。候选顺序不代表榜单名次，也不包含指标数据；请在跑榜前核对名单。',
    };
  }

  private async findExactClass(title: string, language: string): Promise<Scope> {
    const url = new URL(API_ENDPOINT);
    url.search = new URLSearchParams({ action: 'wbsearchentities', format: 'json', search: title, language, uselang: language, type: 'item', limit: '10' }).toString();
    const payload = await this.requestJson(url, 'application/json');
    const search = record(payload)?.search;
    if (!Array.isArray(search)) {
      throw new ServiceUnavailableException('实体来源搜索暂时不可用，请稍后重试。');
    }
    const exact = search.map(record).filter((item) => {
      const label = item?.label;
      const alias = record(item?.match)?.text;
      const id = item?.id;
      return typeof id === 'string' && /^Q[1-9]\d*$/.test(id)
        && [label, alias].some((value) => typeof value === 'string' && normalize(value) === title);
    });
    const unique = [...new Map(exact.map((item) => [item!.id, item!])).values()];
    if (unique.length !== 1) {
      throw new BadRequestException(`暂时无法唯一匹配“${title}”的对象类别。当前仅支持公开知识库完整名称或别名匹配；不会省略范围条件，也不会猜测业务含义。通用自然语言解析尚未启用。`);
    }
    return { label: title, qid: unique[0].id as string };
  }

  private buildQuery(scope: Scope, languages: string[], limit: number): string {
    // Generic Wikidata membership vocabulary, not business-specific categories.
    const membership = `{ ?item wdt:P31/wdt:P279* wd:${scope.qid} . } UNION { ?item wdt:P106/wdt:P279* wd:${scope.qid} . }`;
    return `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
SELECT ?item ?itemLabel ?itemDescription WHERE {
  { SELECT DISTINCT ?item ?sitelinks WHERE {
      ${membership}
      ?item wikibase:sitelinks ?sitelinks . FILTER(?sitelinks > 0)
    } ORDER BY DESC(?sitelinks) ?item LIMIT ${limit}
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${languages.join(',')}" . }
} ORDER BY DESC(?sitelinks) ?item`;
  }

  private async requestJson(url: URL, accept: string): Promise<unknown> {
    let dispatcher: ProxyAgent | undefined;
    try {
      const proxy = process.env.ENTITY_DISCOVERY_HTTP_PROXY?.trim() || process.env.CRAWL_HTTP_PROXY?.trim();
      if (proxy) dispatcher = new ProxyAgent(proxy);
      const options = {
        headers: { Accept: accept, 'User-Agent': 'RankingPlatform/0.1 (topic entity discovery; https://www.wikidata.org/)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error' as const,
      };
      const response = dispatcher
        ? await proxyFetch(url, { ...options, dispatcher })
        : await fetch(url, options);
      if (!response.ok) throw new Error(`Source status ${response.status}`);
      if (!response.body) throw new Error('Missing source response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error('Source response exceeds limit');
        }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new ServiceUnavailableException('暂时无法连接 Wikidata 实体来源（可能超时或限流），请稍后重试。此次不会用虚构实体凑数。');
    } finally {
      if (dispatcher) await dispatcher.destroy();
    }
  }
}
