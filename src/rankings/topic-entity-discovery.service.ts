import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { TopicEntityIntentService } from './topic-entity-intent.service';
import { entitySourceJson, sourceRecord } from './topic-entity-source-http';

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

type SourceIdentity = { id: string; label: string };
const API_ENDPOINT = 'https://www.wikidata.org/w/api.php';
const QUERY_ENDPOINT = 'https://query.wikidata.org/sparql';

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim();
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

/** Discovers sourced candidates without any built-in business category or domain rule. */
@Injectable()
export class TopicEntityDiscoveryService {
  constructor(private readonly intent: TopicEntityIntentService) {}

  async discover(args: {
    title: string;
    locale: string;
    count: number;
  }): Promise<EntityDiscoveryResult> {
    if (!Number.isInteger(args.count) || args.count < 1) {
      throw new BadRequestException('自动填充实体数量必须为正整数。');
    }
    const title = args.title.trim();
    if (!title || title.length > 200) {
      throw new BadRequestException('请填写明确的话题名称（不超过 200 字）。');
    }

    const languages = languageCodes(args.locale);
    const plan = await this.intent.resolve(title);
    const sourceLanguage = plan.semantic ? 'en' : languages[0];
    const category = await this.resolveIdentity(plan.category, 'item', sourceLanguage);
    const constraints = await Promise.all(plan.constraints.map(async (constraint) => ({
      property: await this.resolveIdentity(constraint.property, 'property', sourceLanguage),
      value: await this.resolveIdentity(constraint.value, 'item', sourceLanguage),
    })));

    const seen = new Set<string>();
    const entities: DiscoveredTopicEntity[] = [];
    const pageSize = 100;
    let offset = 0;
    let sourceExhausted = false;
    while (entities.length < args.count && !sourceExhausted) {
      const query = this.buildQuery({
        categoryId: category.id,
        membership: plan.membership,
        constraints: constraints.map((constraint) => ({
          propertyId: constraint.property.id,
          valueId: constraint.value.id,
        })),
        languages,
        limit: pageSize,
        offset,
      });
      const url = new URL(QUERY_ENDPOINT);
      url.searchParams.set('query', query);
      url.searchParams.set('format', 'json');
      const payload = await entitySourceJson(url);
      const bindings = sourceRecord(sourceRecord(payload)?.results)?.bindings;
      if (!Array.isArray(bindings)) {
        throw new ServiceUnavailableException('实体来源返回了无法识别的数据，请稍后重试。');
      }
      sourceExhausted = bindings.length < pageSize;
      offset += pageSize;

      const candidates: DiscoveredTopicEntity[] = [];
      for (const binding of bindings) {
        const row = sourceRecord(binding);
        const uri = sourceRecord(row?.item)?.value;
        const label = sourceRecord(row?.itemLabel)?.value;
        const description = sourceRecord(row?.itemDescription)?.value;
        const qid = typeof uri === 'string'
          ? /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/.exec(uri)?.[1]
          : undefined;
        if (!qid || seen.has(qid) || typeof label !== 'string'
          || !label.trim() || /^Q\d+$/.test(label)) continue;
        seen.add(qid);
        candidates.push({
          externalId: qid,
          name: label.trim().slice(0, 300),
          description: typeof description === 'string' ? description.trim().slice(0, 2000) : '',
          type: plan.membership === 'occupation' ? 'PERSON' : 'ENTITY',
          sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
        });
      }
      if (!candidates.length) continue;
      const accepted = await this.intent.review(title, candidates);
      for (const candidate of candidates) {
        if (accepted.has(candidate.externalId)) entities.push(candidate);
        if (entities.length === args.count) break;
      }
    }

    if (!entities.length) {
      throw new BadRequestException(
        `“${args.title}”没有找到能确认符合完整话题范围的公开实体；请调整名称后重试。`,
      );
    }
    return {
      source: 'wikidata',
      strategy: `${plan.semantic ? 'OpenAI 语义解析' : '完整名称精确匹配'}：${category.label}（${category.id}）`
        + constraints.map((constraint) =>
          `；${constraint.property.label}（${constraint.property.id}）=${constraint.value.label}（${constraint.value.id}）`,
        ).join('')
        + (plan.semantic ? '；Wikidata 取数；OpenAI 候选语义核验' : '；Wikidata 取数'),
      entities,
      warning: plan.semantic
        ? '实体身份来自 Wikidata；OpenAI 仅解析范围并核验公开候选相关性。结果可能遗漏或误判，顺序不代表排名，也不包含指标数据，请在跑榜前核对。'
        : '未配置语义服务，本次仅按完整类别名称或别名匹配 Wikidata。顺序不代表排名，也不包含指标数据，请核对名单。',
    };
  }

  private async resolveIdentity(
    term: string,
    type: 'item' | 'property',
    language: string,
  ): Promise<SourceIdentity> {
    const url = new URL(API_ENDPOINT);
    url.search = new URLSearchParams({
      action: 'wbsearchentities',
      format: 'json',
      search: term,
      language,
      uselang: language,
      type,
      limit: '20',
    }).toString();
    const payload = await entitySourceJson(url);
    const search = sourceRecord(payload)?.search;
    if (!Array.isArray(search)) {
      throw new ServiceUnavailableException('实体来源搜索暂时不可用，请稍后重试。');
    }
    const matches = new Map<string, SourceIdentity>();
    for (const raw of search) {
      const item = sourceRecord(raw);
      const id = item?.id;
      const validId = type === 'item' ? /^Q[1-9]\d*$/ : /^P[1-9]\d*$/;
      if (typeof id !== 'string' || !validId.test(id)) continue;
      const exact = [item?.label, sourceRecord(item?.match)?.text]
        .some((value) => typeof value === 'string' && normalize(value) === normalize(term));
      if (!exact) continue;
      matches.set(id, {
        id,
        label: typeof item?.label === 'string' ? item.label : term,
      });
    }
    if (matches.size !== 1) {
      throw new BadRequestException(
        `无法在 Wikidata 中唯一核验“${term}”的${type === 'item' ? '对象范围' : '筛选属性'}。请调整话题名称后重试。`,
      );
    }
    return [...matches.values()][0];
  }

  private buildQuery(args: {
    categoryId: string;
    membership: 'instance' | 'occupation' | 'both';
    constraints: Array<{ propertyId: string; valueId: string }>;
    languages: string[];
    limit: number;
    offset: number;
  }): string {
    // These are provider vocabulary relations. Business classes/properties are resolved at runtime.
    const instance = `?item wdt:P31/wdt:P279* wd:${args.categoryId} .`;
    const occupation = `?item wdt:P106/wdt:P279* wd:${args.categoryId} .`;
    const membership = args.membership === 'instance'
      ? instance
      : args.membership === 'occupation'
        ? occupation
        : `{ ${instance} } UNION { ${occupation} }`;
    const constraints = args.constraints
      .map((constraint) => `?item wdt:${constraint.propertyId} wd:${constraint.valueId} .`)
      .join('\n');
    return `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
SELECT ?item ?itemLabel ?itemDescription WHERE {
  { SELECT DISTINCT ?item ?sitelinks WHERE {
      ${membership}
      ${constraints}
      ?item wikibase:sitelinks ?sitelinks . FILTER(?sitelinks > 0)
    } ORDER BY DESC(?sitelinks) ?item LIMIT ${args.limit} OFFSET ${args.offset}
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${args.languages.join(',')}" . }
} ORDER BY DESC(?sitelinks) ?item`;
  }
}
