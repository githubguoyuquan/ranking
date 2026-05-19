import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client, errors } from '@elastic/elasticsearch';
import type { KnnSearch } from '@elastic/elasticsearch/lib/api/types';
import { CrawledUrl, Entity, Prisma } from '@prisma/client';
import { AI_AUDIT_SOURCE_EMBEDDING_SEARCH } from '../ai-audit/ai-audit.constants';
import { PrismaService } from '../prisma/prisma.service';
import { EMBEDDING_DIMS } from './embedding.constants';
import { EmbeddingService } from './embedding.service';
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

type EntityEsDoc = EntityEsSource & { embedding?: number[] };

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
  /** 命中方式：全文或 kNN 向量 */
  match?: 'lexical' | 'vector';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {
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

  private usesWriteAlias(): boolean {
    return process.env.ELASTICSEARCH_USE_WRITE_ALIAS === 'true';
  }

  private refreshOnWrite(): boolean | 'wait_for' {
    return process.env.ELASTICSEARCH_REFRESH_ON_WRITE === 'true';
  }

  /** 写入：`-write` 别名或物理索引 */
  resolveWriteIndex(base: string): string {
    return this.usesWriteAlias() ? `${base}-write` : base;
  }

  /** 检索：含 rollover 物理分片 */
  resolveSearchIndex(base: string): string {
    return this.usesWriteAlias() ? `${base}*` : base;
  }

  scaleHints(): Record<string, unknown> {
    return {
      useWriteAlias: this.usesWriteAlias(),
      refreshOnWrite: this.refreshOnWrite() === true,
      bulkBatchSize: Number(process.env.ELASTICSEARCH_BULK_BATCH_SIZE ?? '500') || 500,
      indexShards: process.env.ELASTICSEARCH_INDEX_SHARDS?.trim() || '3',
      indexReplicas: process.env.ELASTICSEARCH_INDEX_REPLICAS?.trim() || '1',
      rolloverMaxDocs: process.env.ELASTICSEARCH_ROLLOVER_MAX_DOCS?.trim() || '50000000',
      rolloverMaxAge: process.env.ELASTICSEARCH_ROLLOVER_MAX_AGE?.trim() || '30d',
    };
  }

  /**
   * 亿级索引模板：多分片、慢 refresh、rollover 别名条件（需 ILM/运维配合集群）。
   */
  async ensureBillionScaleTemplates(): Promise<unknown> {
    if (!this.client) return { ok: false, detail: 'ELASTICSEARCH_NODE not set' };
    const shards = Number(process.env.ELASTICSEARCH_INDEX_SHARDS ?? '3') || 3;
    const replicas = Number(process.env.ELASTICSEARCH_INDEX_REPLICAS ?? '1') || 1;
    const maxDocs = Number(process.env.ELASTICSEARCH_ROLLOVER_MAX_DOCS ?? '50000000') || 50_000_000;
    const templates: Record<string, unknown> = {};
    for (const pattern of [`${ELASTIC_INDEX_ENTITIES}*`, `${ELASTIC_INDEX_CRAWLED_URLS}*`]) {
      const name = `ranking_${pattern.replace(/\*/g, '')}_template`;
      await this.client.indices.putIndexTemplate({
        name,
        index_patterns: [pattern],
        template: {
          settings: {
            number_of_shards: shards,
            number_of_replicas: replicas,
            refresh_interval: '30s',
            'index.max_result_window': 10000,
          },
        },
      });
      templates[pattern] = { template: name, shards, replicas, maxDocs };
    }
    return {
      ok: true,
      templates,
      hint: 'Enable ELASTICSEARCH_USE_WRITE_ALIAS=true and POST bootstrap-aliases before bulk ingest',
    };
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
            embedding: {
              type: 'dense_vector',
              dims: EMBEDDING_DIMS,
              index: true,
              similarity: 'cosine',
            },
          },
        },
      });
      this.logger.log(`Created index ${ELASTIC_INDEX_ENTITIES}`);
    }
    await this.patchEntityIndexEmbeddingMapping();
    this.entityIndexReady = true;
  }

  /** 旧集群逐字段补 `embedding`（新索引已在 create 中带齐） */
  private async patchEntityIndexEmbeddingMapping(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.indices.putMapping({
        index: ELASTIC_INDEX_ENTITIES,
        properties: {
          embedding: {
            type: 'dense_vector',
            dims: EMBEDDING_DIMS,
            index: true,
            similarity: 'cosine',
          },
        },
      });
    } catch (e) {
      this.logger.debug(
        `entity index embedding mapping: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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
    const doc: EntityEsDoc = { ...entityToEsDoc(e) };
    if (this.embedding.isConfigured()) {
      try {
        const vec = await this.embedding.embedForEntity(e.canonicalName, e.aliases);
        if (vec.length === EMBEDDING_DIMS) doc.embedding = vec;
      } catch (err) {
        this.logger.warn(
          `skip entity ${e.id} embedding: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    try {
      await this.client.index({
        index: this.resolveWriteIndex(ELASTIC_INDEX_ENTITIES),
        id: e.id.toString(),
        document: doc,
        ...(this.refreshOnWrite() ? { refresh: this.refreshOnWrite() } : {}),
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
        index: this.resolveWriteIndex(ELASTIC_INDEX_ENTITIES),
        id: id.toString(),
        ...(this.refreshOnWrite() ? { refresh: this.refreshOnWrite() } : {}),
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
        index: this.resolveWriteIndex(ELASTIC_INDEX_ENTITIES),
        id: id.toString(),
        ...(this.refreshOnWrite() ? { refresh: this.refreshOnWrite() } : {}),
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

    const vectorsById = new Map<string, number[]>();
    const batch = 64;
    if (this.embedding.isConfigured()) {
      for (let i = 0; i < entities.length; i += batch) {
        const chunk = entities.slice(i, i + batch);
        const texts = chunk.map((e) => {
          const a = aliasesToText(e.aliases);
          const name = e.canonicalName.trim();
          return a.length > 0 ? `${name}\n${a}` : name;
        });
        try {
          const vecs = await this.embedding.embedMany(texts, {
            source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
            operation: 'entity_reindex_batch',
          });
          chunk.forEach((e, j) => {
            if (vecs[j]?.length === EMBEDDING_DIMS) {
              vectorsById.set(e.id.toString(), vecs[j]);
            }
          });
        } catch (err) {
          this.logger.warn(
            `reindex entity embeddings batch @${i}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    const writeIndex = this.resolveWriteIndex(ELASTIC_INDEX_ENTITIES);
    const batchSize = Number(process.env.ELASTICSEARCH_BULK_BATCH_SIZE ?? '500') || 500;
    let indexed = 0;
    for (let i = 0; i < entities.length; i += batchSize) {
      const chunk = entities.slice(i, i + batchSize);
      const operations: object[] = [];
      for (const e of chunk) {
        operations.push({
          index: { _index: writeIndex, _id: e.id.toString() },
        });
        const doc: EntityEsDoc = { ...entityToEsDoc(e) };
        const v = vectorsById.get(e.id.toString());
        if (v) doc.embedding = v;
        operations.push(doc);
      }
      const res = await this.client.bulk({
        operations,
        ...(this.refreshOnWrite() ? { refresh: this.refreshOnWrite() } : {}),
      });
      if (res.errors) {
        const first = res.items.find((it) => 'index' in it && it.index?.error);
        const errMsg = first && 'index' in first ? first.index?.error?.reason : 'bulk errors';
        this.logger.error(`Elasticsearch bulk: ${errMsg}`);
        throw new ServiceUnavailableException(`Elasticsearch bulk failed: ${errMsg}`);
      }
      indexed += chunk.length;
    }
    return indexed;
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
        index: this.resolveSearchIndex(ELASTIC_INDEX_ENTITIES),
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
        match: 'lexical',
        ...(highlights && Object.keys(highlights).length > 0 ? { highlights } : {}),
      });
    }
    return out;
  }

  /** kNN 语义检索（需索引中存在 `embedding` 且 API 可用 query vector） */
  async searchEntitiesByVector(queryVector: number[], limit: number): Promise<EntitySearchHit[]> {
    return this.runEntityKnnSearch(queryVector, limit, null);
  }

  /** 与给定向量最近的实体；`excludeEntityId` 排除自身 */
  async knnSimilarEntities(
    queryVector: number[],
    excludeEntityId: bigint,
    limit: number,
  ): Promise<EntitySearchHit[]> {
    return this.runEntityKnnSearch(queryVector, limit, excludeEntityId);
  }

  private async runEntityKnnSearch(
    queryVector: number[],
    limit: number,
    excludeEntityId: bigint | null,
  ): Promise<EntitySearchHit[]> {
    if (!this.client) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    if (queryVector.length !== EMBEDDING_DIMS) {
      throw new ServiceUnavailableException(
        `query vector dim ${queryVector.length} (expected ${EMBEDDING_DIMS})`,
      );
    }
    await this.ensureEntityIndex();

    const size = Math.min(Math.max(limit, 1), 50);
    const knn: KnnSearch = {
      field: 'embedding',
      query_vector: queryVector,
      k: size,
      num_candidates: Math.min(400, Math.max(size * 20, 50)),
      ...(excludeEntityId !== null
        ? {
            filter: {
              bool: {
                must_not: [{ term: { entityId: excludeEntityId.toString() } }],
              },
            },
          }
        : {}),
    };

    let res;
    try {
      res = await this.client.search({
        index: this.resolveSearchIndex(ELASTIC_INDEX_ENTITIES),
        knn,
        size,
        _source: ['entityId', 'canonicalName', 'type'],
      });
    } catch (e) {
      this.logger.warn(`runEntityKnnSearch: ${e instanceof Error ? e.message : String(e)}`);
      throw new ServiceUnavailableException(
        `Elasticsearch kNN failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const out: EntitySearchHit[] = [];
    for (const hit of res.hits.hits) {
      const src = hit._source as
        | { entityId?: string; canonicalName?: string; type?: string }
        | undefined;
      out.push({
        entityId: src?.entityId ?? String(hit._id ?? ''),
        score: hit._score ?? 0,
        canonicalName: src?.canonicalName ?? '',
        type: src?.type ?? '',
        match: 'vector',
      });
    }
    return out;
  }

  /** 读取已索引实体的向量（无字段或缺失时返回 null） */
  async fetchEntityEmbeddingFromIndex(entityId: bigint): Promise<number[] | null> {
    if (!this.client) return null;
    await this.ensureEntityIndex();
    try {
      const g = await this.client.get({
        index: this.resolveSearchIndex(ELASTIC_INDEX_ENTITIES),
        id: entityId.toString(),
        _source: ['embedding'],
      });
      const emb = (g._source as { embedding?: number[] } | undefined)?.embedding;
      if (!emb || emb.length !== EMBEDDING_DIMS) return null;
      return emb;
    } catch (e: unknown) {
      if (e instanceof errors.ResponseError && e.statusCode === 404) return null;
      throw e;
    }
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
        index: this.resolveWriteIndex(ELASTIC_INDEX_CRAWLED_URLS),
        id: r.id.toString(),
        document: crawledUrlToEsDoc(r),
        ...(this.refreshOnWrite() ? { refresh: this.refreshOnWrite() } : {}),
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
        index: this.resolveWriteIndex(ELASTIC_INDEX_CRAWLED_URLS),
        id: id.toString(),
        ...(this.refreshOnWrite() ? { refresh: this.refreshOnWrite() } : {}),
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

    const writeIndex = this.resolveWriteIndex(ELASTIC_INDEX_CRAWLED_URLS);
    const batchSize = Number(process.env.ELASTICSEARCH_BULK_BATCH_SIZE ?? '500') || 500;
    let indexed = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const operations: object[] = [];
      for (const r of chunk) {
        operations.push({
          index: { _index: writeIndex, _id: r.id.toString() },
        });
        operations.push(crawledUrlToEsDoc(r));
      }
      const res = await this.client.bulk({
        operations,
        ...(this.refreshOnWrite() ? { refresh: this.refreshOnWrite() } : {}),
      });
      if (res.errors) {
        const first = res.items.find((it) => 'index' in it && it.index?.error);
        const errMsg = first && 'index' in first ? first.index?.error?.reason : 'bulk errors';
        this.logger.error(`Elasticsearch crawled-url bulk: ${errMsg}`);
        throw new ServiceUnavailableException(`Elasticsearch bulk failed: ${errMsg}`);
      }
      indexed += chunk.length;
    }
    return indexed;
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
        index: this.resolveSearchIndex(ELASTIC_INDEX_CRAWLED_URLS),
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

  /** 索引统计（运维 / 滚动决策） */
  async getIndexStats(): Promise<unknown> {
    if (!this.client) return { ok: false, detail: 'ELASTICSEARCH_NODE not set' };
    const indices = [ELASTIC_INDEX_ENTITIES, ELASTIC_INDEX_CRAWLED_URLS];
    const stats = await this.client.indices.stats({ index: indices.join(',') });
    return { ok: true, indices: stats.indices ?? {} };
  }

  private writeAliasName(baseIndex: string): string {
    return `${baseIndex}-write`;
  }

  /**
   * 对 `{index}-write` 别名执行 rollover（需先 `bootstrapWriteAliases`）。
   * 未启用别名模式时返回说明性错误。
   */
  async rolloverWriteAlias(
    baseIndex: string,
    conditions?: { maxDocs?: number; maxAge?: string },
  ): Promise<{ alias: string; ok: boolean; newIndex?: string; detail?: string }> {
    if (!this.client) {
      return { alias: baseIndex, ok: false, detail: 'ELASTICSEARCH_NODE not set' };
    }
    if (process.env.ELASTICSEARCH_USE_WRITE_ALIAS !== 'true') {
      return {
        alias: baseIndex,
        ok: false,
        detail: 'Set ELASTICSEARCH_USE_WRITE_ALIAS=true and POST /admin/scale/elasticsearch/bootstrap-aliases',
      };
    }
    const alias = this.writeAliasName(baseIndex);
    try {
      const exists = await this.client.indices.existsAlias({ name: alias });
      if (!exists) {
        return { alias, ok: false, detail: `write alias ${alias} missing; bootstrap first` };
      }
      const res = await this.client.indices.rollover({
        alias,
        conditions: {
          ...(conditions?.maxDocs ? { max_docs: conditions.maxDocs } : {}),
          ...(conditions?.maxAge ? { max_age: conditions.maxAge } : {}),
        },
      });
      return {
        alias,
        ok: Boolean(res.rolled_over),
        newIndex: res.new_index,
        detail: res.rolled_over ? 'rolled_over' : 'conditions not met',
      };
    } catch (e) {
      return {
        alias,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** 将现有物理索引挂为 `-write` 别名（`is_write_index`），供 rollover 使用 */
  async bootstrapWriteAliases(): Promise<unknown> {
    if (!this.client) return { ok: false, detail: 'ELASTICSEARCH_NODE not set' };
    const results: Record<string, unknown> = {};
    for (const base of [ELASTIC_INDEX_ENTITIES, ELASTIC_INDEX_CRAWLED_URLS]) {
      if (base === ELASTIC_INDEX_ENTITIES) await this.ensureEntityIndex();
      else await this.ensureCrawledUrlIndex();
      const alias = this.writeAliasName(base);
      await this.client.indices.putAlias({
        index: base,
        name: alias,
        is_write_index: true,
      });
      results[base] = { alias, physical: base, bootstrapped: true };
    }
    return { ok: true, results };
  }
}
