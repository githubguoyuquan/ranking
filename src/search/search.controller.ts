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
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AI_AUDIT_SOURCE_EMBEDDING_SEARCH } from '../ai-audit/ai-audit.constants';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { elasticEntitySyncOutboxCreate } from './elastic-entity-outbox';
import { ElasticService } from './elastic.service';
import { EmbeddingService } from './embedding.service';

class SearchEntitiesQueryDto {
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
   * 默认 `es`（未配 `ELASTICSEARCH_NODE` 时 503，与历史一致）；
   * `pg` 仅 PostgreSQL（canonicalName + aliases）；
   * `auto` 有 ES 用 ES，否则 PG。
   */
  @IsOptional()
  @IsIn(['es', 'pg', 'auto'])
  engine?: 'es' | 'pg' | 'auto';

  /** `true` / `1`：对查询句做 embedding，走 ES kNN（需 OPENAI_API_KEY + ELASTICSEARCH_NODE） */
  @IsOptional()
  @Transform(
    ({ value }) => value === true || value === 'true' || value === '1' || value === 1,
  )
  @IsBoolean()
  semantic?: boolean;
}

class SearchCrawledUrlsQueryDto {
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

class UnifiedSearchQueryDto {
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

  /** 爬取结果：`auto` 在配置 ES 时走索引否则 PG；`es` / `pg` 强制 */
  @IsOptional()
  @IsIn(['auto', 'es', 'pg'])
  crawlIndex?: 'auto' | 'es' | 'pg';

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

  /** 实体：`auto` 有 ES 走索引否则 PG；`es` / `pg` 强制 */
  @IsOptional()
  @IsIn(['auto', 'es', 'pg'])
  entityIndex?: 'auto' | 'es' | 'pg';

  /** 实体块走向量 kNN（需 OPENAI_API_KEY + ES；与 `entityIndex=pg` 互斥时以语义检索优先报错见响应 detail） */
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
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  @Get('v1/search/health')
  async searchHealth() {
    return toPlainJson(await this.elastic.ping());
  }

  /**
   * 一次请求聚合：实体（`entityIndex`：默认 auto，无 ES 时 **PostgreSQL** ILIKE `canonicalName` + `aliases`）+
   * 爬取 URL（`crawlIndex`：默认 auto）。爬取关键词长度不足 2 时跳过爬取块。
   */
  @Get('v1/search')
  async unifiedSearch(@Query() query: UnifiedSearchQueryDto) {
    const q = query.q.trim();
    const lim = Math.min(Math.max(query.limit ?? 12, 1), 30);
    const crawlPref = query.crawlIndex ?? 'auto';
    const crawlSourceId = parseOptionalSourceId(query.sourceId);
    const crawlStatus = query.status?.trim();

    const entityPref = query.entityIndex ?? 'auto';

    const [entities, crawledUrls] = await Promise.all([
      this.unifiedEntitiesPart(q, lim, entityPref, query.entitySemantic === true),
      this.unifiedCrawledPart(q, lim, crawlPref, crawlSourceId, crawlStatus),
    ]);

    return toPlainJson({ query: q, entities, crawledUrls });
  }

  @Get('v1/search/entities')
  async searchEntities(@Query() query: SearchEntitiesQueryDto) {
    const q = query.q.trim();
    const lim = query.limit ?? 20;
    const engine = query.engine ?? 'es';

    if (query.semantic) {
      if (!this.elastic.isEnabled()) {
        throw new BadRequestException(
          'semantic search requires Elasticsearch (ELASTICSEARCH_NODE)',
        );
      }
      if (!this.embedding.isConfigured()) {
        throw new ServiceUnavailableException(
          'semantic search requires OPENAI_API_KEY',
        );
      }
      const vec = await this.embedding.embedText(q, {
        source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
        operation: 'v1_entity_semantic',
      });
      const hits = await this.elastic.searchEntitiesByVector(vec, lim);
      return toPlainJson({
        query: q,
        engine: 'elasticsearch',
        mode: 'vector',
        count: hits.length,
        hits,
      });
    }

    if (engine === 'pg' || (engine === 'auto' && !this.elastic.isEnabled())) {
      const hits = await this.searchEntitiesPostgres(q, lim);
      return toPlainJson({
        query: q,
        engine: 'postgresql',
        count: hits.length,
        hits,
      });
    }

    if (!this.elastic.isEnabled()) {
      throw new ServiceUnavailableException(
        'Elasticsearch not configured (ELASTICSEARCH_NODE)',
      );
    }

    const hits = await this.elastic.searchEntities(q, lim);
    return toPlainJson({
      query: q,
      engine: 'elasticsearch',
      count: hits.length,
      hits,
    });
  }

  /** PG：`url` / `textPreview` 不区分大小写子串匹配（依赖已抓取并写入 preview 的行） */
  @Get('v1/search/crawled-urls')
  async searchCrawledUrls(@Query() query: SearchCrawledUrlsQueryDto) {
    const take = query.limit ?? 20;
    const sourceId = parseOptionalSourceId(query.sourceId);
    const status = query.status?.trim();
    const needle = query.q.trim();

    const rows = await this.prisma.crawledUrl.findMany({
      where: {
        AND: [
          {
            OR: [
              { url: { contains: needle, mode: 'insensitive' } },
              { textPreview: { contains: needle, mode: 'insensitive' } },
              { pageTitle: { contains: needle, mode: 'insensitive' } },
            ],
          },
          ...(sourceId !== undefined ? [{ sourceId }] : []),
          ...(status ? [{ status }] : []),
        ],
      },
      orderBy: { id: 'desc' },
      take,
      include: {
        source: { select: { id: true, name: true, baseUrl: true, kind: true } },
      },
    });

    return toPlainJson({
      query: needle,
      count: rows.length,
      hits: rows,
    });
  }

  /**
   * Elasticsearch：`url` / `textPreview` 全文（与 `ranking_crawled_urls` 索引；抓取成功行由 Outbox 异步 upsert）。
   * 未配置 `ELASTICSEARCH_NODE` 时 503。
   */
  @Get('v1/search/crawled-urls-es')
  async searchCrawledUrlsEs(@Query() query: SearchCrawledUrlsQueryDto) {
    if (!this.elastic.isEnabled()) {
      throw new ServiceUnavailableException('Elasticsearch not configured (ELASTICSEARCH_NODE)');
    }
    const take = query.limit ?? 20;
    const sourceId = parseOptionalSourceId(query.sourceId);
    const status = query.status?.trim();
    const needle = query.q.trim();
    const hits = await this.elastic.searchCrawledUrlDocs(needle, take, {
      sourceId,
      status: status || undefined,
    });
    return toPlainJson({
      query: needle,
      engine: 'elasticsearch',
      count: hits.length,
      hits,
    });
  }

  /**
   * 列表实体（运营台/脚本）；可选 `q` 子串匹配 canonicalName
   *
   * **OpenAPI 3** 手写片段：`docs/openapi/admin-entities.yaml`
   */
  @Get('admin/entities')
  async listEntities(@Query('q') q?: string, @Query('limit') limitRaw?: string) {
    const take = Math.min(Math.max(Number(limitRaw) || 40, 1), 100);
    const needle = q?.trim();
    const rows = await this.prisma.entity.findMany({
      where: needle
        ? { canonicalName: { contains: needle, mode: 'insensitive' } }
        : undefined,
      orderBy: { id: 'desc' },
      take,
    });
    return toPlainJson(rows);
  }

  /** 创建实体；启用 ES 时与 Outbox 同事务，提交后由 Flusher 异步写索引 */
  @Post('admin/entities')
  async createEntity(@Body() body: CreateEntityAdminDto) {
    const data: Prisma.EntityCreateInput = {
      type: body.type?.trim() || 'PERSON',
      canonicalName: body.canonicalName.trim(),
    };
    if (body.aliases !== undefined && body.aliases.length > 0) {
      data.aliases = body.aliases;
    }

    if (this.elastic.isEnabled()) {
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
  async patchEntity(@Param('id') id: string, @Body() body: PatchEntityAdminDto) {
    const bid = parseEntityIdParam(id);
    const existing = await this.prisma.entity.findUnique({ where: { id: bid } });
    if (!existing) throw new NotFoundException();

    const data: Prisma.EntityUpdateInput = {};
    if (body.canonicalName !== undefined) data.canonicalName = body.canonicalName.trim();
    if (body.aliases !== undefined) {
      data.aliases = body.aliases.length === 0 ? Prisma.JsonNull : body.aliases;
    }
    if (Object.keys(data).length === 0) {
      return toPlainJson(existing);
    }

    if (this.elastic.isEnabled()) {
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
  async deleteEntity(@Param('id') id: string) {
    const bid = parseEntityIdParam(id);
    if (this.elastic.isEnabled()) {
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

  /** 从数据库全量灌实体索引（需 ES 已启动且配置 NODE） */
  @Post('admin/reindex-entities')
  async reindexEntities() {
    const indexed = await this.elastic.reindexAllEntitiesFromDb();
    return toPlainJson({ ok: true, indexed });
  }

  /** 将 `status=fetched` 的 CrawledUrl 全量写入 `ranking_crawled_urls`（旁路或未走 Outbox 时修复） */
  @Post('admin/reindex-crawl-docs')
  async reindexCrawlDocs() {
    const indexed = await this.elastic.reindexFetchedCrawlDocsFromDb();
    return toPlainJson({ ok: true, indexed });
  }

  private async searchEntitiesPostgres(
    q: string,
    lim: number,
  ): Promise<Array<{ entityId: string; score: number; canonicalName: string; type: string }>> {
    const pattern = `%${q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    type Row = { id: bigint; type: string; canonicalName: string };
    const rows = await this.prisma.$queryRaw<Row[]>(
      Prisma.sql`
        SELECT id, type, "canonicalName"
        FROM "Entity"
        WHERE
          "canonicalName" ILIKE ${pattern} ESCAPE '\\'
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
        ORDER BY id DESC
        LIMIT ${Number(lim)}
      `,
    );
    return rows.map((r) => ({
      entityId: r.id.toString(),
      score: 1,
      canonicalName: r.canonicalName,
      type: r.type,
    }));
  }

  private async unifiedEntitiesPart(
    q: string,
    lim: number,
    entityPref: 'auto' | 'es' | 'pg',
    entitySemantic: boolean,
  ): Promise<{
    source: 'elasticsearch' | 'postgresql' | 'off';
    hits: Array<{
      entityId: string;
      score: number;
      canonicalName: string;
      type: string;
      match?: 'lexical' | 'vector';
      highlights?: Record<string, string[]>;
    }>;
    detail?: string;
    error?: string;
    vectorSearch?: boolean;
  }> {
    if (entitySemantic) {
      if (!this.embedding.isConfigured()) {
        return {
          source: 'off',
          hits: [],
          detail: 'entitySemantic requires OPENAI_API_KEY',
          vectorSearch: true,
        };
      }
      if (!this.elastic.isEnabled()) {
        return {
          source: 'off',
          hits: [],
          detail: 'entitySemantic requires ELASTICSEARCH_NODE',
          vectorSearch: true,
        };
      }
      try {
        const vec = await this.embedding.embedText(q, {
          source: AI_AUDIT_SOURCE_EMBEDDING_SEARCH,
          operation: 'aggregate_entity_semantic',
        });
        const hits = await this.elastic.searchEntitiesByVector(vec, lim);
        return { source: 'elasticsearch', hits, vectorSearch: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          source: 'elasticsearch',
          hits: [],
          error: msg,
          vectorSearch: true,
        };
      }
    }

    const useEs =
      entityPref === 'es' || (entityPref === 'auto' && this.elastic.isEnabled());

    if (useEs) {
      if (!this.elastic.isEnabled()) {
        return {
          source: 'off',
          hits: [],
          detail: 'ELASTICSEARCH_NODE not set (entityIndex=es)',
        };
      }
      try {
        const hits = await this.elastic.searchEntities(q, lim);
        return { source: 'elasticsearch', hits };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { source: 'elasticsearch', hits: [], error: msg };
      }
    }

    try {
      const hits = await this.searchEntitiesPostgres(q, lim);
      return { source: 'postgresql', hits };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { source: 'postgresql', hits: [], error: msg };
    }
  }

  private async unifiedCrawledPart(
    q: string,
    lim: number,
    crawlPref: 'auto' | 'es' | 'pg',
    sourceId?: bigint,
    status?: string,
  ): Promise<{
    source: 'elasticsearch' | 'postgresql' | 'skipped' | 'off';
    hits: unknown[];
    note?: string;
    detail?: string;
    error?: string;
  }> {
    if (q.length < 2) {
      return {
        source: 'skipped',
        hits: [],
        note: 'Crawled URL search needs q length >= 2 (substring / full-text)',
      };
    }

    const useEs =
      crawlPref === 'es' || (crawlPref === 'auto' && this.elastic.isEnabled());
    if (useEs) {
      if (!this.elastic.isEnabled()) {
        return {
          source: 'off',
          hits: [],
          detail: 'ELASTICSEARCH_NODE not set (crawlIndex=es)',
        };
      }
      try {
        const hits = await this.elastic.searchCrawledUrlDocs(q, lim, {
          sourceId,
          status: status || undefined,
        });
        return { source: 'elasticsearch', hits };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { source: 'elasticsearch', hits: [], error: msg };
      }
    }

    const rows = await this.prisma.crawledUrl.findMany({
      where: {
        AND: [
          {
            OR: [
              { url: { contains: q, mode: 'insensitive' } },
              { textPreview: { contains: q, mode: 'insensitive' } },
              { pageTitle: { contains: q, mode: 'insensitive' } },
            ],
          },
          ...(sourceId !== undefined ? [{ sourceId }] : []),
          ...(status ? [{ status }] : []),
        ],
      },
      orderBy: { id: 'desc' },
      take: lim,
      include: {
        source: { select: { id: true, name: true, baseUrl: true, kind: true } },
      },
    });
    return { source: 'postgresql', hits: rows };
  }
}
