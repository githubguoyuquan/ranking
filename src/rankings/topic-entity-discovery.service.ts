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
  type: string;
  relation: 'occupation' | 'instance' | 'either';
  countryProperty?: 'P27' | 'P17' | 'P495';
  country?: { label: string; qid: string };
  gender?: { label: string; qid: string };
  playerProfile?: string;
  professionDescription?: string;
};

const CATEGORIES: Array<Scope & { pattern: RegExp }> = [
  { label: '足球运动员', qid: 'Q937857', type: 'person', relation: 'occupation', countryProperty: 'P27', playerProfile: 'P2446', professionDescription: 'football|soccer', pattern: /足球(?:运动员|球员|球星)?|\b(?:association\s+football|soccer|football)(?:\s+(?:players?|stars?))?\b/iu },
  { label: '篮球运动员', qid: 'Q3665646', type: 'person', relation: 'occupation', countryProperty: 'P27', pattern: /篮球(?:运动员|球员|球星)?|\bbasketball(?:\s+(?:players?|stars?))?\b/iu },
  { label: '网球运动员', qid: 'Q10833314', type: 'person', relation: 'occupation', countryProperty: 'P27', pattern: /网球(?:运动员|球员|球星)?|\btennis(?:\s+(?:players?|stars?))?\b/iu },
  { label: '歌手', qid: 'Q177220', type: 'person', relation: 'occupation', countryProperty: 'P27', pattern: /歌手|歌星|\bsingers?\b/iu },
  { label: '演员', qid: 'Q33999', type: 'person', relation: 'occupation', countryProperty: 'P27', pattern: /演员|\b(?:actors?|actresses)\b/iu },
  { label: '大学', qid: 'Q3918', type: 'organization', relation: 'instance', countryProperty: 'P17', pattern: /大学|高校|\buniversit(?:y|ies)\b/iu },
  { label: '公司', qid: 'Q783794', type: 'organization', relation: 'instance', countryProperty: 'P17', pattern: /公司|企业|\bcompan(?:y|ies)\b/iu },
  { label: '电影', qid: 'Q11424', type: 'work', relation: 'instance', countryProperty: 'P495', pattern: /电影|影片|\b(?:films?|movies?)\b/iu },
];

const COUNTRIES = [
  { label: '中国', qid: 'Q148', pattern: /中国|\b(?:china|chinese)\b/iu },
  { label: '美国', qid: 'Q30', pattern: /美国|\b(?:united states|american|usa)\b/iu },
  { label: '英国', qid: 'Q145', pattern: /英国|\b(?:united kingdom|british|uk)\b/iu },
  { label: '法国', qid: 'Q142', pattern: /法国|\b(?:france|french)\b/iu },
  { label: '德国', qid: 'Q183', pattern: /德国|\b(?:germany|german)\b/iu },
  { label: '日本', qid: 'Q17', pattern: /日本|\b(?:japan|japanese)\b/iu },
  { label: '韩国', qid: 'Q884', pattern: /韩国|\b(?:south korea|south korean)\b/iu },
  { label: '巴西', qid: 'Q155', pattern: /巴西|\b(?:brazil|brazilian)\b/iu },
  { label: '阿根廷', qid: 'Q414', pattern: /阿根廷|\b(?:argentina|argentine|argentinian)\b/iu },
  { label: '西班牙', qid: 'Q29', pattern: /西班牙|\b(?:spain|spanish)\b/iu },
  { label: '意大利', qid: 'Q38', pattern: /意大利|\b(?:italy|italian)\b/iu },
  { label: '加拿大', qid: 'Q16', pattern: /加拿大|\b(?:canada|canadian)\b/iu },
  { label: '澳大利亚', qid: 'Q408', pattern: /澳大利亚|\b(?:australia|australian)\b/iu },
  { label: '印度', qid: 'Q668', pattern: /印度|\b(?:india|indian)\b/iu },
  { label: '葡萄牙', qid: 'Q45', pattern: /葡萄牙|\b(?:portugal|portuguese)\b/iu },
  { label: '荷兰', qid: 'Q55', pattern: /荷兰|\b(?:netherlands|dutch)\b/iu },
];

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
    .replace(/排行榜|排名榜|榜单|排名|榜|\b(?:rankings?|leaderboards?|list)\b/giu, '')
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
      throw new BadRequestException('请填写具体话题名称，例如“足球球星榜”或“全球女歌手榜”。');
    }
    if (/^(?:全球|世界)?球星$/u.test(title.replace(/\s/gu, ''))) {
      throw new BadRequestException('“球星”包含多种运动，请把话题名称写成“足球球星榜”或“篮球球星榜”，再自动填充。');
    }

    const languages = languageCodes(args.locale);
    const scope = this.knownScope(title) ?? await this.findExactClass(title, languages[0]);
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
        type: scope.type.toUpperCase(),
        sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
      });
      if (entities.length === args.count) break;
    }
    if (entities.length === 0) {
      throw new BadRequestException(`“${args.title}”没有找到可核验的实体，请使用更明确的话题名称后重试。`);
    }
    return {
      source: 'wikidata',
      strategy: [scope.country?.label, scope.gender?.label, scope.label].filter(Boolean).join(' · ') +
        (scope.playerProfile ? '；要求具备球员资料编号' : '') + '；按百科覆盖度选择候选',
      entities,
      warning: '实体来自 Wikidata，按百科覆盖度选取，可能包含历史人物或历史对象。候选顺序不代表榜单名次，也不包含指标数据；请在跑榜前核对名单。',
    };
  }

  private knownScope(title: string): Scope | undefined {
    const categories = CATEGORIES.filter((category) => category.pattern.test(title));
    if (categories.length !== 1) return undefined;
    const category = categories[0];
    let remainder = title.replace(category.pattern, '');
    const countries = COUNTRIES.filter((country) => country.pattern.test(remainder));
    if (countries.length > 1) return undefined;
    const country = countries[0];
    if (country) remainder = remainder.replace(country.pattern, '');
    const genders = [
      { label: '女性', qid: 'Q6581072', pattern: /女子|女性|女|\b(?:female|women(?:'s)?)\b/iu },
      { label: '男性', qid: 'Q6581097', pattern: /男子|男性|男|\b(?:male|men(?:'s)?)\b/iu },
    ].filter((gender) => gender.pattern.test(remainder));
    if (genders.length > 1 || (genders.length && category.relation !== 'occupation')) return undefined;
    const gender = genders[0];
    if (gender) remainder = remainder.replace(gender.pattern, '');
    remainder = remainder.replace(/全球|世界|历史|\b(?:global|world|worldwide|all[ -]time)\b/giu, '').replace(/\s/gu, '');
    // Unknown constraints (league, current season, technology, club, etc.) must not be silently discarded.
    if (remainder) return undefined;
    return { ...category, country, gender };
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
      throw new BadRequestException(`暂时无法准确识别“${title}”的实体范围。请使用具体类别，例如“足球球星榜”“篮球球星榜”“全球女歌手榜”或“中国大学榜”；联赛、现役、年份等额外条件目前不能保证自动识别。`);
    }
    return { label: title, qid: unique[0].id as string, type: 'entity', relation: 'either' };
  }

  private buildQuery(scope: Scope, languages: string[], limit: number): string {
    const occupation = `?item wdt:P31 wd:Q5; wdt:P106/wdt:P279* wd:${scope.qid} .`;
    const instance = `?item wdt:P31/wdt:P279* wd:${scope.qid} .`;
    const membership = scope.relation === 'occupation' ? occupation : scope.relation === 'instance' ? instance : `{ ${instance} } UNION { ${occupation} }`;
    const filters = [
      scope.country && scope.countryProperty ? `?item wdt:${scope.countryProperty} wd:${scope.country.qid} .` : '',
      scope.gender ? `?item wdt:P21 wd:${scope.gender.qid} .` : '',
      scope.playerProfile ? `?item wdt:${scope.playerProfile} ?playerProfile .` : '',
      scope.professionDescription ? `FILTER EXISTS { ?item schema:description ?profession . FILTER(LANG(?profession) = "en" && REGEX(STR(?profession), "${scope.professionDescription}", "i")) }` : '',
    ].filter(Boolean).join('\n');
    return `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX schema: <http://schema.org/>
SELECT ?item ?itemLabel ?itemDescription WHERE {
  { SELECT DISTINCT ?item ?sitelinks WHERE {
      ${membership}
      ${filters}
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
