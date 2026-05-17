import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client, errors } from '@elastic/elasticsearch';
import { CrawledUrl, Entity, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ELASTIC_INDEX_CRAWLED_URLS, ELASTIC_INDEX_ENTITIES } from './elastic.constants';

function aliasesToText(aliases: Prisma.JsonValue | null | undefined): string {
  if (aliases === null || aliases === undefined) return '';
  if (Array.isArray(aliases)) {
    return aliases.filter((x): x is string => typeof x === 'string').join(' ');
  }
  if (typeof aliases === 'object') return JSON.stringify(aliases);
  return String(aliases);
}

type EntityEsSource = {
  entityId: string;
  type: string;
  canonicalName: string;
  aliases: string;
};

function entityToEsDoc(e: Pick<Entity, 'id' | 'type' | 'canonicalName' | 'aliases'>): EntityEsSource {
  return {
    entityId: e.id.toString(),
    type: e.type,
    canonicalName: e.canonicalName,
    aliases: aliasesToText(e.aliases),
  };
}

type CrawledUrlEsSource = {
  crawledUrlId: string;
  sourceId: string;
  url: string;
  mimeType: string | null;
  textPreview: string | null;
  pageTitle: string | null;
  status: string;
  fetchedAt: string | null;
};

export type EntitySearchHit = {
  entityId: string;
  score: number;
  canonicalName: string;
  type: string;
  /** Elasticsearch `highlight` 字段：含 `<em>...</em>`，便于前端展示 */
  highlights?: Record<string, string[]>;
};

export type CrawledUrlSearchHit = {
  crawledUrlId: string;
  score: number;
  url: string;
  sourceId: string;
  mimeType: string | null;
  status: string;
  pageTitle: string | null;
  snippet: string;
  highlights?: Record<string, string[]>;
};

function crawledUrlToEsDoc(
  r: Pick<
    CrawledUrl,
    | 'id'
    | 'sourceId'
    | 'url'
    | 'mimeType'
    | 'textPreview'
    | 'pageTitle'
    | 'status'
    | 'fetchedAt'
  >,
): CrawledUrlEsSource {
  return {
    crawledUrlId: r.id.toString(),
    sourceId: r.sourceId.toString(),
    url: r.url,
    mimeType: r.mimeType,
    textPreview: r.textPreview,
    pageTitle: r.pageTitle,
    status: r.status,
    fetchedAt: r.fetchedAt ? r.fetchedAt.toISOString() : null,
  };
}

@Injectable()
export class ElasticService implements OnModuleDestroy {
  private readonly logger = new Logger(ElasticService.name);
  private client: Client | null = null;
  private entityIndexReady = false;
  private crawledUrlIndexReady = false;

  constructor(private readonly prisma: PrismaService) {
    const node = process.env.ELASTICSEARCH_NODE?.trim();
    if (!node) {
      this.logger.warn('ELASTICSEARCH_NODE not set — Elasticsearch features disabled');
      return;
    }
    this.client = new Client({ node, requestTimeout: 30_000 });
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  async ping(): Promise<{ ok: boolean; clusterName?: string; detail?: string }> {
    if (!this.client) return { ok: false, detail: 'ELASTICSEARCH_NODE not set' };
    try {
      const info = await this.client.info();
      return { ok: true, clusterName: info.cluster_name };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async ensureEntityIndex(): Promise<void> {
    if (!this.client) return;
    if (this.entityIndexReady) return;

    const exists = await this.client.indices.exists({ index: ELASTIC_INDEX_ENTITIES });
    if (!exists) {
      await this.client.indices.create({
        index: ELASTIC_INDEX_ENTITIES,
        mappings: {
          properties: {
            entityId: { type: 'keyword' },
            type: { type: 'keyword' },
            canonicalName: {
              type: 'text',
              analyzer: 'standard',
              fields: { keyword: { type: 'keyword', ignore_above: 256 } },
            },
            aliases: { type: 'text', analyzer: 'standard' },
          },
        },
      });
      this.logger.log(`Created index ${ELASTIC_INDEX_ENTITIES}`);
    }
    this.entityIndexReady = true;
  }

  async ensureCrawledUrlIndex(): Promise<void> {
    if (!this.client) return;
    if (this.crawledUrlIndexReady) return;

    const exists = await this.client.indices.exists({ index: ELASTIC_INDEX_CRAWLED_URLS });
    if (!exists) {
      await this.client.indices.create({
        index: ELASTIC_INDEX_CRAWLED_URLS,
        mappings: {
          properties: {
            crawledUrlId: { type: 'keyword' },
            sourceId: { type: 'keyword' },
            url: {
              type: 'text',
              analyzer: 'standard',
              fields: { keyword: { type: 'keyword', ignore_above: 2048 } },
            },
            mimeType: { type: 'keyword' },
            textPreview: { type: 'text', analyzer: 'standard' },
            pageTitle: { type: 'text', analyzer: 'standard' },
            status: { type: 'keyword' },
            fetchedAt: { type: 'date' },
          },
        },
      });
      this.logger.log(`Created index ${ELASTIC_INDEX_CRAWLED_URLS}`);
    }
    this.crawledUrlIndexReady = true;
  }

  /** 单条写入；未配置 ES 时为 no-op；ES 报错时抛出 */
  async upsertEntityFromRow(e: Entity): Promise<void> {
    if (!this.client) return;
    await this.ensureEntityIndex();
    try {
      await this.client.index({
        index: ELASTIC_INDEX_ENTITIES,
        id: e.id.toString(),
        document: entityToEsDoc(e),
        refresh: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Elasticsearch upsert entity ${e.id}: ${msg}`);
      throw new ServiceUnavailableException(`Elasticsearch upsert failed: ${msg}`);
    }
  }

  /** PG 已删行后调用；ES 失败只打日志（避免 5xx 掩盖已成功的 PG 删除） */
  async deleteEntityFromIndexForFlusher(id: bigint): Promise<void> {
    if (!this.client) return;
    await this.ensureEntityIndex();
    try {
      await this.client.delete({
        index: ELASTIC_INDEX_ENTITIES,
        id: id.toString(),
        refresh: true,
      });
    } catch (e: unknown) {
      if (e instanceof errors.ResponseError && e.statusCode === 404) return;
      throw e;
    }
  }

  /** PG 已删行后调用；ES 失败只打日志（避免 5xx 掩盖已成功的 PG 删除） */
  async removeEntityFromIndex(id: bigint): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.delete({
        index: ELASTIC_INDEX_ENTITIES,
        id: id.toString(),
        refresh: true,
      });
    } catch (e: unknown) {
      if (e instanceof errors.ResponseError && e.statusCode === 404) return;
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Elasticsearch delete entity ${id} (non-fatal): ${msg}`);
    }
  }

  async reindexAllEntitiesFromDb(): Promise<number> {
    if (!this.client) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    await this.ensureEntityIndex();
    const entities = await this.prisma.entity.findMany();
    if (entities.length === 0) return 0;

    const operations: object[] = [];
    for (const e of entities) {
      operations.push({
        index: { _index: ELASTIC_INDEX_ENTITIES, _id: e.id.toString() },
      });
      operations.push(entityToEsDoc(e));
    }

    const res = await this.client.bulk({ operations, refresh: true });
    if (res.errors) {
      const first = res.items.find((i) => 'index' in i && i.index?.error);
      const errMsg = first && 'index' in first ? first.index?.error?.reason : 'bulk errors';
      this.logger.error(`Elasticsearch bulk: ${errMsg}`);
      throw new ServiceUnavailableException(`Elasticsearch bulk failed: ${errMsg}`);
    }
    return entities.length;
  }

  async searchEntities(
    q: string,
    limit: number,
  ): Promise<EntitySearchHit[]> {
    if (!this.client) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    await this.ensureEntityIndex();

    const size = Math.min(Math.max(limit, 1), 50);
    let res;
    try {
      res = await this.client.search({
        index: ELASTIC_INDEX_ENTITIES,
        query: {
          multi_match: {
            query: q,
            fields: ['canonicalName^2', 'aliases'],
            type: 'best_fields',
            fuzziness: 'AUTO',
          },
        },
        size,
        _source: ['entityId', 'canonicalName', 'type'],
        highlight: {
          fields: {
            canonicalName: { number_of_fragments: 0 },
            aliases: { number_of_fragments: 2, fragment_size: 140 },
          },
          pre_tags: ['<em>'],
          post_tags: ['</em>'],
        },
      });
    } catch (e) {
      this.logger.warn(`searchEntities: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException(
        `Elasticsearch query failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const out: EntitySearchHit[] = [];
    for (const hit of res.hits.hits) {
      const src = hit._source as
        | { entityId?: string; canonicalName?: string; type?: string }
        | undefined;
      const rawHl = hit.highlight as Record<string, string[]> | undefined;
      const highlights =
        rawHl && Object.keys(rawHl).length > 0
          ? Object.fromEntries(
              Object.entries(rawHl).filter(([, v]) => Array.isArray(v) && v.length > 0),
            )
          : undefined;
      out.push({
        entityId: src?.entityId ?? String(hit._id ?? ''),
        score: hit._score ?? 0,
        canonicalName: src?.canonicalName ?? '',
        type: src?.type ?? '',
        ...(highlights && Object.keys(highlights).length > 0 ? { highlights } : {}),
      });
    }
    return out;
  }

  /** Flusher：仅索引 `status=fetched`；否则删 ES 文档 */
  async upsertCrawledUrlFromRowForFlusher(r: CrawledUrl): Promise<void> {
    if (!this.client) return;
    await this.ensureCrawledUrlIndex();
    if (r.status !== 'fetched') {
      await this.deleteCrawledUrlFromIndexForFlusher(r.id);
      return;
    }
    try {
      await this.client.index({
        index: ELASTIC_INDEX_CRAWLED_URLS,
        id: r.id.toString(),
        document: crawledUrlToEsDoc(r),
        refresh: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Elasticsearch upsert crawled url ${r.id}: ${msg}`);
      throw new ServiceUnavailableException(`Elasticsearch upsert failed: ${msg}`);
    }
  }

  async deleteCrawledUrlFromIndexForFlusher(id: bigint): Promise<void> {
    if (!this.client) return;
    await this.ensureCrawledUrlIndex();
    try {
      await this.client.delete({
        index: ELASTIC_INDEX_CRAWLED_URLS,
        id: id.toString(),
        refresh: true,
      });
    } catch (e: unknown) {
      if (e instanceof errors.ResponseError && e.statusCode === 404) return;
      throw e;
    }
  }

  async reindexFetchedCrawlDocsFromDb(): Promise<number> {
    if (!this.client) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    await this.ensureCrawledUrlIndex();
    const rows = await this.prisma.crawledUrl.findMany({ where: { status: 'fetched' } });
    if (rows.length === 0) return 0;

    const operations: object[] = [];
    for (const r of rows) {
      operations.push({
        index: { _index: ELASTIC_INDEX_CRAWLED_URLS, _id: r.id.toString() },
      });
      operations.push(crawledUrlToEsDoc(r));
    }

    const res = await this.client.bulk({ operations, refresh: true });
    if (res.errors) {
      const first = res.items.find((i) => 'index' in i && i.index?.error);
      const errMsg = first && 'index' in first ? first.index?.error?.reason : 'bulk errors';
      this.logger.error(`Elasticsearch crawled-url bulk: ${errMsg}`);
      throw new ServiceUnavailableException(`Elasticsearch bulk failed: ${errMsg}`);
    }
    return rows.length;
  }

  async searchCrawledUrlDocs(
    q: string,
    limit: number,
    filters?: { sourceId?: bigint; status?: string },
  ): Promise<CrawledUrlSearchHit[]> {
    if (!this.client) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    await this.ensureCrawledUrlIndex();

    const size = Math.min(Math.max(limit, 1), 50);
    const filter: object[] = [];
    if (filters?.sourceId !== undefined) {
      filter.push({ term: { sourceId: filters.sourceId.toString() } });
    }
    if (filters?.status !== undefined && filters.status.length > 0) {
      filter.push({ term: { status: filters.status } });
    }

    let res;
    try {
      res = await this.client.search({
        index: ELASTIC_INDEX_CRAWLED_URLS,
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: q,
                  fields: ['url^2', 'pageTitle^1.5', 'textPreview'],
                  type: 'best_fields',
                  fuzziness: 'AUTO',
                },
              },
            ],
            filter: filter.length ? filter : undefined,
          },
        },
        size,
        _source: [
          'crawledUrlId',
          'url',
          'sourceId',
          'mimeType',
          'status',
          'textPreview',
          'pageTitle',
        ],
        highlight: {
          fields: {
            url: { number_of_fragments: 1, fragment_size: 180 },
            pageTitle: { number_of_fragments: 0 },
            textPreview: { number_of_fragments: 2, fragment_size: 220 },
          },
          pre_tags: ['<em>'],
          post_tags: ['</em>'],
        },
      });
    } catch (e) {
      this.logger.warn(`searchCrawledUrlDocs: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException(
        `Elasticsearch query failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const out: CrawledUrlSearchHit[] = [];
    for (const hit of res.hits.hits) {
      const src = hit._source as
        | {
            crawledUrlId?: string;
            url?: string;
            sourceId?: string;
            mimeType?: string | null;
            status?: string;
            textPreview?: string | null;
            pageTitle?: string | null;
          }
        | undefined;
      const preview = src?.textPreview ?? '';
      const rawHl = hit.highlight as Record<string, string[]> | undefined;
      const highlights =
        rawHl && Object.keys(rawHl).length > 0
          ? Object.fromEntries(
              Object.entries(rawHl).filter(([, v]) => Array.isArray(v) && v.length > 0),
            )
          : undefined;
      const snippetRaw =
        rawHl?.textPreview?.[0] ??
        rawHl?.pageTitle?.[0] ??
        rawHl?.url?.[0] ??
        (preview.length > 280 ? `${preview.slice(0, 280)}…` : preview);
      out.push({
        crawledUrlId: src?.crawledUrlId ?? String(hit._id ?? ''),
        score: hit._score ?? 0,
        url: src?.url ?? '',
        sourceId: src?.sourceId ?? '',
        mimeType: src?.mimeType ?? null,
        status: src?.status ?? '',
        pageTitle: src?.pageTitle ?? null,
        snippet: snippetRaw,
        ...(highlights && Object.keys(highlights).length > 0 ? { highlights } : {}),
      });
    }
    return out;
  }
}
