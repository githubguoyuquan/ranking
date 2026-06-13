import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AI_AUDIT_SOURCE_EMBEDDING_SEARCH } from '../ai-audit/ai-audit.constants';
import {
  reciprocalRankFusion,
  rrfKFromEnv,
} from '../domain/reciprocal-rank-fusion';
import type { SearchDslFilters, SearchDslParseResult } from '../domain/search-dsl';
import { parseSearchDsl } from '../domain/search-dsl';
import { PrismaService } from '../prisma/prisma.service';
import {
  ElasticService,
  type CrawledUrlSearchHit,
  type EntitySearchHit,
} from './elastic.service';
import { EmbeddingService } from './embedding.service';
import { QdrantSearchService } from './qdrant-search.service';

export type SearchEngine = 'qdrant' | 'elasticsearch' | 'postgresql';

export type CrawlSearchFilters = {
  sourceId?: bigint;
  status?: string;
  fetchedSince?: Date;
  fetchedUntil?: Date;
};

@Injectable()
export class HybridSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly elastic: ElasticService,
    private readonly qdrant: QdrantSearchService,
    private readonly embedding: EmbeddingService,
  ) {}

  parseQuery(
    raw: string,
    explicit: {
      type?: string;
      topic?: string;
      sourceId?: string;
      status?: string;
      since?: string;
      until?: string;
    } = {},
  ): SearchDslParseResult {
    return parseSearchDsl(raw, explicit);
  }

  async searchEntities(opts: {
    parsed: SearchDslParseResult;
    limit: number;
    engine: SearchEngine;
    hybrid: boolean;
  }): Promise<{
    hits: EntitySearchHit[];
    mode: 'lexical' | 'vector' | 'hybrid';
    engine: SearchEngine;
    detail?: string;
  }> {
    const { parsed, limit, engine, hybrid } = opts;
    const q = parsed.text;
    const lim = Math.min(Math.max(limit, 1), 50);
    const fetchN = hybrid ? Math.min(lim * 3, 50) : lim;

    if (hybrid) {
      if (engine === 'postgresql') {
        throw new BadRequestException(
          'hybrid search requires qdrant or elasticsearch (engine=pg not supported)',
        );
      }
      if (!this.embedding.isConfigured()) {
        throw new ServiceUnavailableException('hybrid search requires OPENAI_API_KEY');
      }
      const vec = await this.embedding.embedText(q || 'entity', {
        source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
        operation: 'v1_entity_hybrid',
      });
      const [lexical, vector] = await Promise.all([
        this.runEntityLexical(q, fetchN, engine),
        engine === 'qdrant'
          ? this.qdrant.searchEntitiesByVector(vec, fetchN)
          : this.elastic.searchEntitiesByVector(vec, fetchN),
      ]);
      const fused = reciprocalRankFusion(
        [
          { name: 'lexical', hits: lexical, idOf: (h) => h.entityId },
          { name: 'vector', hits: vector, idOf: (h) => h.entityId },
        ],
        rrfKFromEnv(),
      );
      let hits: EntitySearchHit[] = fused.slice(0, lim).map(({ hit, score, ranks }) => ({
        ...hit,
        score,
        match: 'hybrid' as const,
        rrfScore: score,
        rankContributions: ranks,
      }));
      hits = await this.applyEntityFilters(hits, parsed.filters);
      return { hits, mode: 'hybrid', engine };
    }

    if (!q && Object.keys(parsed.filters).length > 0) {
      const hits = await this.listEntitiesByFilters(parsed.filters, lim);
      return { hits, mode: 'lexical', engine, detail: 'filter-only browse' };
    }

    let hits =
      engine === 'postgresql'
        ? await this.searchEntitiesPostgres(q, fetchN, parsed.filters)
        : await this.runEntityLexical(q, fetchN, engine);
    hits = await this.applyEntityFilters(hits, parsed.filters);
    return { hits: hits.slice(0, lim), mode: 'lexical', engine };
  }

  async searchCrawledUrls(opts: {
    parsed: SearchDslParseResult;
    limit: number;
    engine: SearchEngine;
    hybrid: boolean;
    explicitSourceId?: bigint;
    explicitStatus?: string;
  }): Promise<{
    hits: CrawledUrlSearchHit[] | unknown[];
    mode: 'lexical' | 'hybrid';
    engine: SearchEngine | 'skipped';
  }> {
    const q = opts.parsed.text;
    if (q.length < 2 && !opts.parsed.filters.since && !opts.parsed.filters.until) {
      return { hits: [], mode: 'lexical', engine: 'skipped' };
    }

    const crawlFilters = this.buildCrawlFilters(
      opts.parsed.filters,
      opts.explicitSourceId,
      opts.explicitStatus,
    );

    if (opts.engine === 'postgresql') {
      const rows = await this.searchCrawledPostgres(q, opts.limit, crawlFilters);
      return { hits: rows, mode: 'lexical', engine: 'postgresql' };
    }

    const needle = q.length >= 2 ? q : '*';
    const hits =
      opts.engine === 'qdrant'
        ? await this.qdrant.searchCrawledUrlDocs(needle, opts.limit, crawlFilters)
        : await this.elastic.searchCrawledUrlDocs(needle, opts.limit, crawlFilters);

    if (!opts.hybrid || !this.embedding.isConfigured() || q.length < 2) {
      return { hits, mode: 'lexical', engine: opts.engine };
    }

    return { hits, mode: 'lexical', engine: opts.engine };
  }

  private buildCrawlFilters(
    filters: SearchDslFilters,
    explicitSourceId?: bigint,
    explicitStatus?: string,
  ): CrawlSearchFilters {
    let sourceId = explicitSourceId;
    if (filters.sourceId) {
      try {
        sourceId = BigInt(filters.sourceId);
      } catch {
        throw new BadRequestException('invalid source filter in DSL');
      }
    }
    return {
      sourceId,
      status: explicitStatus?.trim() || filters.status,
      fetchedSince: filters.since,
      fetchedUntil: filters.until,
    };
  }

  private async runEntityLexical(
    q: string,
    limit: number,
    engine: SearchEngine,
  ): Promise<EntitySearchHit[]> {
    if (engine === 'qdrant') {
      if (!this.qdrant.isEnabled()) {
        throw new ServiceUnavailableException('Qdrant not configured (QDRANT_URL)');
      }
      return q ? this.qdrant.searchEntities(q, limit) : [];
    }
    if (!this.elastic.isEnabled()) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    return q ? this.elastic.searchEntities(q, limit) : [];
  }

  private async applyEntityFilters(
    hits: EntitySearchHit[],
    filters: SearchDslFilters,
  ): Promise<EntitySearchHit[]> {
    let out = hits;
    if (filters.type) {
      const t = filters.type.toUpperCase();
      out = out.filter((h) => h.type.toUpperCase() === t);
    }
    if (filters.topic) {
      const allowed = await this.resolveTopicEntityIds(filters.topic);
      if (allowed) {
        const set = new Set(allowed.map((id) => id.toString()));
        out = out.filter((h) => set.has(h.entityId));
      }
    }
    if (filters.since || filters.until) {
      const ids = out.map((h) => BigInt(h.entityId));
      const rows =
        ids.length === 0
          ? []
          : await this.prisma.entity.findMany({
              where: {
                id: { in: ids },
                ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
                ...(filters.until ? { createdAt: { lte: filters.until } } : {}),
              },
              select: { id: true },
            });
      const ok = new Set(rows.map((r) => r.id.toString()));
      out = out.filter((h) => ok.has(h.entityId));
    }
    return out;
  }

  private async resolveTopicEntityIds(topicSlug: string): Promise<bigint[] | null> {
    const slug = topicSlug.trim();
    const topic = await this.prisma.topic.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (!topic) return null;

    const version = await this.prisma.topicVersion.findFirst({
      where: { topicId: topic.id },
      orderBy: { effectiveFrom: 'desc' },
      select: { policyJson: true },
    });
    const policy = version?.policyJson as { entityIds?: string[] } | null;
    if (policy?.entityIds?.length) {
      return policy.entityIds.map((x) => BigInt(x));
    }

    const hist = await this.prisma.rankingItemHistory.findMany({
      where: { topicId: topic.id },
      distinct: ['entityId'],
      select: { entityId: true },
      take: 500,
    });
    return hist.map((h) => h.entityId);
  }

  private async listEntitiesByFilters(
    filters: SearchDslFilters,
    limit: number,
  ): Promise<EntitySearchHit[]> {
    const topicIds = filters.topic
      ? await this.resolveTopicEntityIds(filters.topic)
      : undefined;
    const rows = await this.prisma.entity.findMany({
      where: {
        ...(filters.type ? { type: filters.type.toUpperCase() } : {}),
        ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
        ...(filters.until ? { createdAt: { lte: filters.until } } : {}),
        ...(topicIds?.length ? { id: { in: topicIds } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit,
      select: { id: true, type: true, canonicalName: true },
    });
    return rows.map((r) => ({
      entityId: r.id.toString(),
      score: 1,
      canonicalName: r.canonicalName,
      type: r.type,
      match: 'lexical' as const,
    }));
  }

  private async searchEntitiesPostgres(
    q: string,
    lim: number,
    filters: SearchDslFilters,
  ): Promise<EntitySearchHit[]> {
    const pattern = `%${q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    const topicIds = filters.topic ? await this.resolveTopicEntityIds(filters.topic) : undefined;

    type Row = { id: bigint; type: string; canonicalName: string };
    const rows = await this.prisma.$queryRaw<Row[]>(
      Prisma.sql`
        SELECT id, type, "canonicalName"
        FROM "Entity"
        WHERE
          (
            ${q.length === 0}
            OR "canonicalName" ILIKE ${pattern} ESCAPE '\\'
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(
                CASE
                  WHEN aliases IS NULL THEN '[]'::jsonb
                  WHEN jsonb_typeof(aliases::jsonb) = 'array' THEN aliases::jsonb
                  ELSE '[]'::jsonb
                END
              ) AS al(val)
              WHERE al.val ILIKE ${pattern} ESCAPE '\\'
            )
          )
          ${filters.type ? Prisma.sql`AND type = ${filters.type.toUpperCase()}` : Prisma.empty}
          ${filters.since ? Prisma.sql`AND "createdAt" >= ${filters.since}` : Prisma.empty}
          ${filters.until ? Prisma.sql`AND "createdAt" <= ${filters.until}` : Prisma.empty}
          ${
            topicIds?.length
              ? Prisma.sql`AND id IN (${Prisma.join(topicIds)})`
              : Prisma.empty
          }
        ORDER BY id DESC
        LIMIT ${Number(lim)}
      `,
    );
    return rows.map((r) => ({
      entityId: r.id.toString(),
      score: 1,
      canonicalName: r.canonicalName,
      type: r.type,
      match: 'lexical' as const,
    }));
  }

  private async searchCrawledPostgres(
    q: string,
    limit: number,
    filters: CrawlSearchFilters,
  ) {
    const needle = q.length >= 2 ? q.trim() : '';
    const rows = await this.prisma.crawledUrl.findMany({
      where: {
        AND: [
          ...(needle
            ? [
                {
                  OR: [
                    { url: { contains: needle, mode: 'insensitive' as const } },
                    { textPreview: { contains: needle, mode: 'insensitive' as const } },
                    { pageTitle: { contains: needle, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
          ...(filters.sourceId !== undefined ? [{ sourceId: filters.sourceId }] : []),
          ...(filters.status ? [{ status: filters.status }] : []),
          ...(filters.fetchedSince ? [{ fetchedAt: { gte: filters.fetchedSince } }] : []),
          ...(filters.fetchedUntil ? [{ fetchedAt: { lte: filters.fetchedUntil } }] : []),
        ],
      },
      orderBy: { fetchedAt: 'desc' },
      take: limit,
      include: {
        source: { select: { id: true, name: true, baseUrl: true, kind: true } },
      },
    });
    return rows;
  }
}
