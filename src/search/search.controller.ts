import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PiiLevel } from '@prisma/client';
import { RequireScopes } from '../compliance/api-key.guard';
import { redactEntityRecord } from '../compliance/entity-pii';
import { getAuthFromRequest } from '../compliance/request-auth';
import { AI_AUDIT_SOURCE_EMBEDDING_SEARCH } from '../ai-audit/ai-audit.constants';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { elasticEntitySyncOutboxCreate } from './elastic-entity-outbox';
import { ElasticService } from './elastic.service';
import { EmbeddingService } from './embedding.service';
import { QdrantSearchService } from './qdrant-search.service';
import { HybridSearchService, type SearchEngine } from './hybrid-search.service';
import { resolveSearchPrimary } from './search-primary';

class SearchDslQueryDto {
  /** 内联 DSL 示例：`type:PERSON since:7d keyword`；亦可用下列显式参数 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  topic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  since?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  until?: string;

  /** 全文 + 本地向量 RRF 融合（需 qdrant/es） */
  @IsOptional()
  @Transform(
    ({ value }) => value === true || value === 'true' || value === '1' || value === 1,
  )
  @IsBoolean()
  hybrid?: boolean;
}

class SearchEntitiesQueryDto extends SearchDslQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /**
   * 默认 `auto`（`SEARCH_PRIMARY`：Qdrant → ES → PG）；
   * `qdrant` / `es` / `pg` 强制指定引擎。
   */
  @IsOptional()
  @IsIn(['qdrant', 'es', 'pg', 'auto'])
  engine?: 'qdrant' | 'es' | 'pg' | 'auto';

  /** `true` / `1`：对查询句做本地 embedding，走 ES kNN（需 ELASTICSEARCH_NODE） */
  @IsOptional()
  @Transform(
    ({ value }) => value === true || value === 'true' || value === '1' || value === 1,
  )
  @IsBoolean()
  semantic?: boolean;
}

class SearchCrawledUrlsQueryDto extends SearchDslQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceId?: string;

  /** 例如 fetched、fetched_stub、fetch_failed；不传则不限状态 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class UnifiedSearchQueryDto extends SearchDslQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;

  /** 爬取结果：`auto` 按 `SEARCH_PRIMARY`；`qdrant` / `es` / `pg` 强制 */
  @IsOptional()
  @IsIn(['auto', 'qdrant', 'es', 'pg'])
  crawlIndex?: 'auto' | 'qdrant' | 'es' | 'pg';

  /** 仅过滤爬取命中：数据源 ID */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceId?: string;

  /** 仅过滤爬取命中：如 fetched */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  /** 实体：`auto` 按 `SEARCH_PRIMARY`；`qdrant` / `es` / `pg` 强制 */
  @IsOptional()
  @IsIn(['auto', 'qdrant', 'es', 'pg'])
  entityIndex?: 'auto' | 'qdrant' | 'es' | 'pg';

  /** 实体块走本地向量 kNN（需 ES；与 `entityIndex=pg` 互斥时以语义检索优先报错见响应 detail） */
  @IsOptional()
  @Transform(
    ({ value }) => value === true || value === 'true' || value === '1' || value === 1,
  )
  @IsBoolean()
  entitySemantic?: boolean;
}

export class CreateEntityAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  canonicalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  type?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsEnum(PiiLevel)
  piiLevel?: PiiLevel;
}

export class PatchEntityAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  canonicalName?: string;

  /** 传空数组 `[]` 表示清空别名 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsEnum(PiiLevel)
  piiLevel?: PiiLevel;
}

function parseEntityIdParam(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    throw new BadRequestException('invalid entity id');
  }
}

function parseOptionalSourceId(raw: string | undefined): bigint | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  try {
    return BigInt(raw.trim());
  } catch {
    throw new BadRequestException('invalid sourceId');
  }
}

@Controller()
export class SearchController {
  constructor(
    private readonly elastic: ElasticService,
    private readonly qdrant: QdrantSearchService,
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly hybrid: HybridSearchService,
  ) {}

  private searchIndexEnabled(): boolean {
    return this.elastic.isEnabled() || this.qdrant.isEnabled();
  }

  private primaryEngine(): ReturnType<typeof resolveSearchPrimary> {
    return resolveSearchPrimary(this.qdrant, this.elastic);
  }

  @Get('v1/search/health')
  async searchHealth() {
    const [elastic, qdrant] = await Promise.all([
      this.elastic.ping(),
      this.qdrant.ping(),
    ]);
    return toPlainJson({
      primary: this.primaryEngine(),
      searchPrimaryEnv: process.env.SEARCH_PRIMARY?.trim() || 'auto',
      elasticsearch: elastic,
      qdrant,
    });
  }

  /**
   * 一次请求聚合：实体（`entityIndex`：默认 auto，无 ES 时 **PostgreSQL** ILIKE `canonicalName` + `aliases`）+
   * 爬取 URL（`crawlIndex`：默认 auto）。爬取关键词长度不足 2 时跳过爬取块。
   */
  @Get('v1/search')
  async unifiedSearch(@Query() query: UnifiedSearchQueryDto) {
    const rawQ = query.q.trim();
    const lim = Math.min(Math.max(query.limit ?? 12, 1), 30);
    const parsed = this.hybrid.parseQuery(rawQ, {
      type: query.type,
      topic: query.topic,
      since: query.since,
      until: query.until,
      sourceId: query.sourceId,
      status: query.status,
    });

    const [entities, crawledUrls] = await Promise.all([
      this.unifiedEntitiesPart(
        parsed,
        lim,
        query.entityIndex ?? 'auto',
        query.entitySemantic === true,
        query.hybrid === true,
      ),
      this.unifiedCrawledPart(
        parsed,
        lim,
        query.crawlIndex ?? 'auto',
        parseOptionalSourceId(query.sourceId),
        query.status?.trim(),
        query.hybrid === true,
      ),
    ]);

    return toPlainJson({
      query: rawQ,
      dsl: {
        text: parsed.text,
        filters: {
          ...(parsed.filters.type ? { type: parsed.filters.type } : {}),
          ...(parsed.filters.topic ? { topic: parsed.filters.topic } : {}),
          ...(parsed.filters.sourceId ? { sourceId: parsed.filters.sourceId } : {}),
          ...(parsed.filters.status ? { status: parsed.filters.status } : {}),
          ...(parsed.filters.since
            ? { since: parsed.filters.since.toISOString() }
            : {}),
          ...(parsed.filters.until
            ? { until: parsed.filters.until.toISOString() }
            : {}),
        },
      },
      entities,
      crawledUrls,
    });
  }

  @Get('v1/search/entities')
  async searchEntities(@Query() query: SearchEntitiesQueryDto) {
    const rawQ = query.q.trim();
    const lim = query.limit ?? 20;
    const engine = this.resolveEnginePref(query.engine);
    const parsed = this.hybrid.parseQuery(rawQ, {
      type: query.type,
      topic: query.topic,
      since: query.since,
      until: query.until,
    });

    if (query.hybrid === true) {
      const result = await this.hybrid.searchEntities({
        parsed,
        limit: lim,
        engine,
        hybrid: true,
      });
      return toPlainJson({
        query: rawQ,
        dsl: parsed,
        engine: result.engine,
        mode: result.mode,
        count: result.hits.length,
        hits: result.hits,
      });
    }

    if (query.semantic) {
      if (engine === 'postgresql') {
        throw new BadRequestException(
          'semantic search requires qdrant or elasticsearch (engine=pg not supported)',
        );
      }
      if (!this.embedding.isConfigured()) {
        throw new ServiceUnavailableException(
          'semantic search requires local embeddings',
        );
      }
      const vec = await this.embedding.embedText(parsed.text || rawQ, {
        source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
        operation: 'v1_entity_semantic',
      });
      const hits =
        engine === 'qdrant'
          ? await this.qdrant.searchEntitiesByVector(vec, lim)
          : await this.elastic.searchEntitiesByVector(vec, lim);
      return toPlainJson({
        query: rawQ,
        dsl: parsed,
        engine,
        mode: 'vector',
        count: hits.length,
        hits,
      });
    }

    const result = await this.hybrid.searchEntities({
      parsed,
      limit: lim,
      engine,
      hybrid: false,
    });
    return toPlainJson({
      query: rawQ,
      dsl: parsed,
      engine: result.engine,
      mode: result.mode,
      count: result.hits.length,
      hits: result.hits,
      ...(result.detail ? { detail: result.detail } : {}),
    });
  }

  /** PG：`url` / `textPreview` 不区分大小写子串匹配（依赖已抓取并写入 preview 的行） */
  @Get('v1/search/crawled-urls')
  async searchCrawledUrls(@Query() query: SearchCrawledUrlsQueryDto) {
    const take = query.limit ?? 20;
    const parsed = this.hybrid.parseQuery(query.q.trim(), {
      type: query.type,
      topic: query.topic,
      since: query.since,
      until: query.until,
      sourceId: query.sourceId,
      status: query.status,
    });
    const result = await this.hybrid.searchCrawledUrls({
      parsed,
      limit: take,
      engine: 'postgresql',
      hybrid: query.hybrid === true,
      explicitSourceId: parseOptionalSourceId(query.sourceId),
      explicitStatus: query.status?.trim(),
    });
    return toPlainJson({
      query: query.q.trim(),
      dsl: parsed,
      engine: result.engine,
      mode: result.mode,
      count: Array.isArray(result.hits) ? result.hits.length : 0,
      hits: result.hits,
    });
  }

  /**
   * Elasticsearch：`url` / `textPreview` 全文（与 `ranking_crawled_urls` 索引；抓取成功行由 Outbox 异步 upsert）。
   * 未配置 `ELASTICSEARCH_NODE` 时 503。
   */
  @Get('v1/search/crawled-urls-es')
  async searchCrawledUrlsEs(@Query() query: SearchCrawledUrlsQueryDto) {
    const primary = this.primaryEngine();
    const take = query.limit ?? 20;
    const parsed = this.hybrid.parseQuery(query.q.trim(), {
      since: query.since,
      until: query.until,
      sourceId: query.sourceId,
      status: query.status,
    });
    const engine: SearchEngine =
      primary === 'qdrant' ? 'qdrant' : primary === 'elasticsearch' ? 'elasticsearch' : 'postgresql';
    const result = await this.hybrid.searchCrawledUrls({
      parsed,
      limit: take,
      engine,
      hybrid: query.hybrid === true,
      explicitSourceId: parseOptionalSourceId(query.sourceId),
      explicitStatus: query.status?.trim(),
    });
    return toPlainJson({
      query: query.q.trim(),
      dsl: parsed,
      engine: result.engine,
      mode: result.mode,
      count: Array.isArray(result.hits) ? result.hits.length : 0,
      hits: result.hits,
    });
  }

  /**
   * 列表实体（运营台/脚本）；可选 `q` 子串匹配 canonicalName
   *
   * **OpenAPI 3** 手写片段：`docs/openapi/admin-entities.yaml`
   */
  @Get('admin/entities')
  @RequireScopes('admin')
  async listEntities(
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
    @Req() req?: Request,
  ) {
    const take = Math.min(Math.max(Number(limitRaw) || 40, 1), 100);
    const needle = q?.trim();
    const rows = await this.prisma.entity.findMany({
      where: needle
        ? { canonicalName: { contains: needle, mode: 'insensitive' } }
        : undefined,
      orderBy: { id: 'desc' },
      take,
    });
    const auth = req ? getAuthFromRequest(req) : undefined;
    const scopes = auth?.scopes ?? ['read'];
    return toPlainJson(rows.map((r) => redactEntityRecord(r, scopes)));
  }

  /** 创建实体；启用 ES 时与 Outbox 同事务，提交后由 Flusher 异步写索引 */
  @Post('admin/entities')
  @RequireScopes('admin')
  async createEntity(@Body() body: CreateEntityAdminDto, @Req() req: Request) {
    const auth = getAuthFromRequest(req);
    const data: Prisma.EntityCreateInput = {
      type: body.type?.trim() || 'PERSON',
      canonicalName: body.canonicalName.trim(),
      ...(body.piiLevel ? { piiLevel: body.piiLevel } : {}),
      ...(auth?.tenantId ? { tenant: { connect: { id: auth.tenantId } } } : {}),
    };
    if (body.aliases !== undefined && body.aliases.length > 0) {
      data.aliases = body.aliases;
    }

    if (this.searchIndexEnabled()) {
      const e = await this.prisma.$transaction(async (tx) => {
        const created = await tx.entity.create({ data });
        await tx.outboxEvent.create({
          data: elasticEntitySyncOutboxCreate(created.id, 'upsert'),
        });
        return created;
      });
      return toPlainJson(e);
    }

    const e = await this.prisma.entity.create({ data });
    return toPlainJson(e);
  }

  @Patch('admin/entities/:id')
  @RequireScopes('admin')
  async patchEntity(@Param('id') id: string, @Body() body: PatchEntityAdminDto) {
    const bid = parseEntityIdParam(id);
    const existing = await this.prisma.entity.findUnique({ where: { id: bid } });
    if (!existing) throw new NotFoundException();

    const data: Prisma.EntityUpdateInput = {};
    if (body.canonicalName !== undefined) data.canonicalName = body.canonicalName.trim();
    if (body.aliases !== undefined) {
      data.aliases = body.aliases.length === 0 ? Prisma.JsonNull : body.aliases;
    }
    if (body.piiLevel !== undefined) data.piiLevel = body.piiLevel;
    if (Object.keys(data).length === 0) {
      return toPlainJson(existing);
    }

    if (this.searchIndexEnabled()) {
      const e = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.entity.update({ where: { id: bid }, data });
        await tx.outboxEvent.create({
          data: elasticEntitySyncOutboxCreate(updated.id, 'upsert'),
        });
        return updated;
      });
      return toPlainJson(e);
    }

    const e = await this.prisma.entity.update({ where: { id: bid }, data });
    return toPlainJson(e);
  }

  @Delete('admin/entities/:id')
  @RequireScopes('admin')
  async deleteEntity(@Param('id') id: string) {
    const bid = parseEntityIdParam(id);
    if (this.searchIndexEnabled()) {
      await this.prisma.$transaction(async (tx) => {
        await tx.outboxEvent.create({
          data: elasticEntitySyncOutboxCreate(bid, 'delete'),
        });
        await tx.entity.delete({ where: { id: bid } });
      });
    } else {
      await this.prisma.entity.delete({ where: { id: bid } });
    }
    return toPlainJson({ ok: true });
  }

  /** 全量灌实体检索索引（主引擎 Qdrant 或 ES，由配置决定） */
  @Post('admin/reindex-entities')
  async reindexEntities() {
    const primary = this.primaryEngine();
    if (primary === 'qdrant') {
      const indexed = await this.qdrant.reindexAllEntitiesFromDb();
      return toPlainJson({ ok: true, engine: 'qdrant', indexed });
    }
    const indexed = await this.elastic.reindexAllEntitiesFromDb();
    return toPlainJson({ ok: true, engine: 'elasticsearch', indexed });
  }

  /** 全量灌爬取 URL 检索索引 */
  @Post('admin/reindex-crawl-docs')
  async reindexCrawlDocs() {
    const primary = this.primaryEngine();
    if (primary === 'qdrant') {
      const indexed = await this.qdrant.reindexFetchedCrawlDocsFromDb();
      return toPlainJson({ ok: true, engine: 'qdrant', indexed });
    }
    const indexed = await this.elastic.reindexFetchedCrawlDocsFromDb();
    return toPlainJson({ ok: true, engine: 'elasticsearch', indexed });
  }

  private resolveEnginePref(
    pref?: 'auto' | 'qdrant' | 'es' | 'pg',
  ): SearchEngine {
    if (pref === 'qdrant') return 'qdrant';
    if (pref === 'es') return 'elasticsearch';
    if (pref === 'pg') return 'postgresql';
    const primary = this.primaryEngine();
    if (primary === 'qdrant') return 'qdrant';
    if (primary === 'elasticsearch') return 'elasticsearch';
    return 'postgresql';
  }

  private resolveIndexPref(
    pref: 'auto' | 'qdrant' | 'es' | 'pg',
  ): 'qdrant' | 'elasticsearch' | 'postgresql' {
    if (pref === 'qdrant') return 'qdrant';
    if (pref === 'es') return 'elasticsearch';
    if (pref === 'pg') return 'postgresql';
    return this.primaryEngine();
  }

  private async unifiedEntitiesPart(
    parsed: ReturnType<HybridSearchService['parseQuery']>,
    lim: number,
    entityPref: 'auto' | 'qdrant' | 'es' | 'pg',
    entitySemantic: boolean,
    hybrid: boolean,
  ): Promise<{
    source: 'qdrant' | 'elasticsearch' | 'postgresql' | 'off';
    hits: Array<{
      entityId: string;
      score: number;
      canonicalName: string;
      type: string;
      match?: 'lexical' | 'vector' | 'hybrid';
      rrfScore?: number;
      rankContributions?: Record<string, number>;
      highlights?: Record<string, string[]>;
    }>;
    detail?: string;
    error?: string;
    vectorSearch?: boolean;
    mode?: string;
  }> {
    const engine = this.resolveIndexPref(entityPref);

    if (hybrid) {
      try {
        const result = await this.hybrid.searchEntities({
          parsed,
          limit: lim,
          engine,
          hybrid: true,
        });
        return {
          source: result.engine,
          hits: result.hits,
          mode: result.mode,
          vectorSearch: true,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { source: engine, hits: [], error: msg, vectorSearch: true, mode: 'hybrid' };
      }
    }

    if (entitySemantic) {
      if (!this.embedding.isConfigured()) {
        return {
          source: 'off',
          hits: [],
          detail: 'entitySemantic requires local embeddings',
          vectorSearch: true,
        };
      }
      const idx = this.resolveIndexPref(entityPref);
      if (idx === 'postgresql') {
        return {
          source: 'off',
          hits: [],
          detail: 'entitySemantic requires qdrant or elasticsearch',
          vectorSearch: true,
        };
      }
      try {
        const vec = await this.embedding.embedText(parsed.text || 'entity', {
          source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
          operation: 'aggregate_entity_semantic',
        });
        const hits =
          idx === 'qdrant'
            ? await this.qdrant.searchEntitiesByVector(vec, lim)
            : await this.elastic.searchEntitiesByVector(vec, lim);
        return { source: idx, hits, vectorSearch: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { source: idx, hits: [], error: msg, vectorSearch: true };
      }
    }

    try {
      const result = await this.hybrid.searchEntities({
        parsed,
        limit: lim,
        engine,
        hybrid: false,
      });
      return {
        source: result.engine,
        hits: result.hits,
        mode: result.mode,
        ...(result.detail ? { detail: result.detail } : {}),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { source: engine, hits: [], error: msg };
    }
  }

  private async unifiedCrawledPart(
    parsed: ReturnType<HybridSearchService['parseQuery']>,
    lim: number,
    crawlPref: 'auto' | 'qdrant' | 'es' | 'pg',
    sourceId?: bigint,
    status?: string,
    hybrid?: boolean,
  ): Promise<{
    source: 'qdrant' | 'elasticsearch' | 'postgresql' | 'skipped' | 'off';
    hits: unknown[];
    note?: string;
    detail?: string;
    error?: string;
  }> {
    if (parsed.text.length < 2 && !parsed.filters.since && !parsed.filters.until) {
      return {
        source: 'skipped',
        hits: [],
        note: 'Crawled URL search needs q length >= 2 or since/until filter',
      };
    }

    const idx = this.resolveIndexPref(crawlPref);
    try {
      const result = await this.hybrid.searchCrawledUrls({
        parsed,
        limit: lim,
        engine: idx,
        hybrid: hybrid === true,
        explicitSourceId: sourceId,
        explicitStatus: status,
      });
      if (result.engine === 'skipped') {
        return {
          source: 'skipped',
          hits: [],
          note: 'Crawled URL search needs q length >= 2 or since/until filter',
        };
      }
      return {
        source: result.engine,
        hits: result.hits,
        ...(result.mode ? { note: `mode=${result.mode}` } : {}),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { source: idx, hits: [], error: msg };
    }
  }
}
