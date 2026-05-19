import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CrawledUrl, Entity, Prisma } from '@prisma/client';
import { AI_AUDIT_SOURCE_EMBEDDING_SEARCH } from '../ai-audit/ai-audit.constants';
import { PrismaService } from '../prisma/prisma.service';
import { EMBEDDING_DIMS } from './embedding.constants';
import { EmbeddingService } from './embedding.service';
import type { CrawledUrlSearchHit, EntitySearchHit } from './elastic.service';
import {
  QDRANT_COLLECTION_CRAWLED_URLS,
  QDRANT_COLLECTION_ENTITIES,
  QDRANT_PLACEHOLDER_VECTOR,
  QDRANT_VECTOR_DIMS,
} from './qdrant.constants';
import { qdrantPointIdFromBigint } from './qdrant-point-id';

function aliasesToText(aliases: Prisma.JsonValue | null | undefined): string {
  if (aliases === null || aliases === undefined) return '';
  if (Array.isArray(aliases)) {
    return aliases.filter((x): x is string => typeof x === 'string').join(' ');
  }
  return String(aliases);
}

function entitySearchText(e: Pick<Entity, 'canonicalName' | 'aliases'>): string {
  const a = aliasesToText(e.aliases);
  const name = e.canonicalName.trim();
  return a.length > 0 ? `${name} ${a}` : name;
}

function crawledSearchText(
  r: Pick<CrawledUrl, 'url' | 'textPreview' | 'pageTitle'>,
): string {
  return [r.pageTitle, r.textPreview, r.url].filter(Boolean).join('\n').slice(0, 8000);
}

@Injectable()
export class QdrantSearchService implements OnModuleInit {
  private readonly logger = new Logger(QdrantSearchService.name);
  private readonly url = process.env.QDRANT_URL?.trim() ?? '';
  private entitiesReady = false;
  private crawledReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  onModuleInit(): void {
    if (this.isEnabled()) {
      void this.ensureEntityCollection().catch((e) => {
        this.logger.warn(
          `Qdrant entity collection init: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }
  }

  isEnabled(): boolean {
    return this.url.length > 0;
  }

  private base(): string {
    return this.url.replace(/\/$/, '');
  }

  async ping(): Promise<{ ok: boolean; detail?: string; collections?: string[] }> {
    if (!this.isEnabled()) {
      return { ok: false, detail: 'QDRANT_URL not set' };
    }
    try {
      const res = await fetch(`${this.base()}/collections`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        return { ok: false, detail: `HTTP ${res.status}` };
      }
      const j = (await res.json()) as {
        result?: { collections?: Array<{ name: string }> };
      };
      const names = j.result?.collections?.map((c) => c.name) ?? [];
      return { ok: true, collections: names };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async qdrantJson<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.base()}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Qdrant ${method} ${path}: HTTP ${res.status} ${text.slice(0, 400)}`,
      );
    }
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async ensureEntityCollection(): Promise<void> {
    if (!this.isEnabled() || this.entitiesReady) return;
    const name = QDRANT_COLLECTION_ENTITIES;
    const exists = await this.collectionExists(name);
    if (!exists) {
      await this.qdrantJson('PUT', `/collections/${name}`, {
        vectors: { size: QDRANT_VECTOR_DIMS, distance: 'Cosine' },
      });
      this.logger.log(`Created Qdrant collection ${name}`);
    }
    await this.ensureTextIndex(name, 'searchText');
    this.entitiesReady = true;
  }

  async ensureCrawledUrlCollection(): Promise<void> {
    if (!this.isEnabled() || this.crawledReady) return;
    const name = QDRANT_COLLECTION_CRAWLED_URLS;
    const exists = await this.collectionExists(name);
    if (!exists) {
      await this.qdrantJson('PUT', `/collections/${name}`, {
        vectors: { size: QDRANT_VECTOR_DIMS, distance: 'Cosine' },
      });
      this.logger.log(`Created Qdrant collection ${name}`);
    }
    await this.ensureTextIndex(name, 'searchText');
    this.crawledReady = true;
  }

  private async collectionExists(name: string): Promise<boolean> {
    try {
      await this.qdrantJson('GET', `/collections/${name}`);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureTextIndex(collection: string, field: string): Promise<void> {
    try {
      await this.qdrantJson('PUT', `/collections/${collection}/index`, {
        field_name: field,
        field_schema: 'text',
      });
    } catch (e) {
      this.logger.debug(
        `Qdrant text index ${collection}.${field}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async upsertEntityFromRow(e: Entity): Promise<void> {
    if (!this.isEnabled()) return;
    await this.ensureEntityCollection();
    let vector = [...QDRANT_PLACEHOLDER_VECTOR];
    if (this.embedding.isConfigured()) {
      try {
        const v = await this.embedding.embedForEntity(e.canonicalName, e.aliases, {
          source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
          operation: 'qdrant_entity_upsert',
        });
        if (v.length === QDRANT_VECTOR_DIMS) vector = v;
      } catch (err) {
        this.logger.warn(
          `Qdrant entity ${e.id} embedding skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.qdrantJson('PUT', `/collections/${QDRANT_COLLECTION_ENTITIES}/points`, {
      wait: true,
      points: [
        {
          id: qdrantPointIdFromBigint(e.id),
          vector,
          payload: {
            entityId: e.id.toString(),
            type: e.type,
            canonicalName: e.canonicalName,
            aliases: aliasesToText(e.aliases),
            searchText: entitySearchText(e),
          },
        },
      ],
    });
  }

  async deleteEntityFromIndex(id: bigint): Promise<void> {
    if (!this.isEnabled()) return;
    await this.ensureEntityCollection();
    await this.qdrantJson('POST', `/collections/${QDRANT_COLLECTION_ENTITIES}/points/delete`, {
      wait: true,
      points: [qdrantPointIdFromBigint(id)],
    });
  }

  async upsertCrawledUrlFromRow(r: CrawledUrl): Promise<void> {
    if (!this.isEnabled()) return;
    await this.ensureCrawledUrlCollection();
    let vector = [...QDRANT_PLACEHOLDER_VECTOR];
    const text = crawledSearchText(r);
    if (this.embedding.isConfigured() && text.length >= 20) {
      try {
        const v = await this.embedding.embedText(text.slice(0, 8000), {
          source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
          operation: 'qdrant_crawl_upsert',
        });
        if (v.length === QDRANT_VECTOR_DIMS) vector = v;
      } catch {
        /* placeholder vector */
      }
    }
    await this.qdrantJson('PUT', `/collections/${QDRANT_COLLECTION_CRAWLED_URLS}/points`, {
      wait: true,
      points: [
        {
          id: qdrantPointIdFromBigint(r.id),
          vector,
          payload: {
            crawledUrlId: r.id.toString(),
            sourceId: r.sourceId.toString(),
            url: r.url,
            mimeType: r.mimeType,
            pageTitle: r.pageTitle,
            textPreview: r.textPreview?.slice(0, 2000) ?? null,
            status: r.status,
            fetchedAt: r.fetchedAt?.toISOString() ?? null,
            searchText: text,
          },
        },
      ],
    });
  }

  async deleteCrawledUrlFromIndex(id: bigint): Promise<void> {
    if (!this.isEnabled()) return;
    await this.ensureCrawledUrlCollection();
    await this.qdrantJson('POST', `/collections/${QDRANT_COLLECTION_CRAWLED_URLS}/points/delete`, {
      wait: true,
      points: [qdrantPointIdFromBigint(id)],
    });
  }

  async searchEntities(q: string, limit: number): Promise<EntitySearchHit[]> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Qdrant not configured (QDRANT_URL)');
    }
    await this.ensureEntityCollection();
    const size = Math.min(Math.max(limit, 1), 50);
    const res = await this.qdrantJson<{
      result?: {
        points?: Array<{
          id: number | string;
          score?: number;
          payload?: Record<string, unknown>;
        }>;
      };
    }>('POST', `/collections/${QDRANT_COLLECTION_ENTITIES}/points/scroll`, {
      limit: size,
      with_payload: true,
      filter: {
        must: [{ key: 'searchText', match: { text: q } }],
      },
    });
    return (res.result?.points ?? []).map((p, i) =>
      this.payloadToEntityHit(p.payload, p.score ?? size - i, 'lexical'),
    );
  }

  async searchEntitiesByVector(
    queryVector: number[],
    limit: number,
  ): Promise<EntitySearchHit[]> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Qdrant not configured (QDRANT_URL)');
    }
    if (queryVector.length !== EMBEDDING_DIMS) {
      throw new ServiceUnavailableException(
        `query vector dim ${queryVector.length} (expected ${EMBEDDING_DIMS})`,
      );
    }
    await this.ensureEntityCollection();
    const size = Math.min(Math.max(limit, 1), 50);
    const res = await this.qdrantJson<{
      result?: Array<{ score: number; payload?: Record<string, unknown> }>;
    }>('POST', `/collections/${QDRANT_COLLECTION_ENTITIES}/points/search`, {
      vector: queryVector,
      limit: size,
      with_payload: true,
    });
    return (res.result ?? []).map((p) =>
      this.payloadToEntityHit(p.payload, p.score, 'vector'),
    );
  }

  async knnSimilarEntities(
    queryVector: number[],
    excludeEntityId: bigint,
    limit: number,
  ): Promise<EntitySearchHit[]> {
    const hits = await this.searchEntitiesByVector(queryVector, limit + 5);
    const ex = excludeEntityId.toString();
    return hits.filter((h) => h.entityId !== ex).slice(0, limit);
  }

  async searchCrawledUrlDocs(
    q: string,
    limit: number,
    filters?: { sourceId?: bigint; status?: string },
  ): Promise<CrawledUrlSearchHit[]> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Qdrant not configured (QDRANT_URL)');
    }
    await this.ensureCrawledUrlCollection();
    const size = Math.min(Math.max(limit, 1), 50);
    const must: Array<Record<string, unknown>> = [
      { key: 'searchText', match: { text: q } },
    ];
    if (filters?.sourceId != null) {
      must.push({
        key: 'sourceId',
        match: { value: filters.sourceId.toString() },
      });
    }
    if (filters?.status) {
      must.push({ key: 'status', match: { value: filters.status } });
    }
    const res = await this.qdrantJson<{
      result?: {
        points?: Array<{ score?: number; payload?: Record<string, unknown> }>;
      };
    }>('POST', `/collections/${QDRANT_COLLECTION_CRAWLED_URLS}/points/scroll`, {
      limit: size,
      with_payload: true,
      filter: { must },
    });
    return (res.result?.points ?? []).map((p, i) =>
      this.payloadToCrawlHit(p.payload, p.score ?? size - i),
    );
  }

  async reindexAllEntitiesFromDb(): Promise<number> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Qdrant not configured (QDRANT_URL)');
    }
    const entities = await this.prisma.entity.findMany();
    for (const e of entities) {
      await this.upsertEntityFromRow(e);
    }
    return entities.length;
  }

  async reindexFetchedCrawlDocsFromDb(): Promise<number> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Qdrant not configured (QDRANT_URL)');
    }
    const rows = await this.prisma.crawledUrl.findMany({
      where: { status: { in: ['fetched', 'fetched_stub', 'fetched_semantic_dup'] } },
    });
    for (const r of rows) {
      await this.upsertCrawledUrlFromRow(r);
    }
    return rows.length;
  }

  private payloadToEntityHit(
    payload: Record<string, unknown> | undefined,
    score: number,
    match: 'lexical' | 'vector',
  ): EntitySearchHit {
    return {
      entityId: String(payload?.entityId ?? ''),
      score,
      canonicalName: String(payload?.canonicalName ?? ''),
      type: String(payload?.type ?? ''),
      match,
    };
  }

  private payloadToCrawlHit(
    payload: Record<string, unknown> | undefined,
    score: number,
  ): CrawledUrlSearchHit {
    const preview = String(payload?.textPreview ?? '');
    return {
      crawledUrlId: String(payload?.crawledUrlId ?? ''),
      score,
      url: String(payload?.url ?? ''),
      sourceId: String(payload?.sourceId ?? ''),
      mimeType: (payload?.mimeType as string | null) ?? null,
      status: String(payload?.status ?? ''),
      pageTitle: (payload?.pageTitle as string | null) ?? null,
      snippet: preview.slice(0, 400),
    };
  }
}
