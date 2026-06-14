import { Body, Controller, Get, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { toPlainJson } from '../lib/json';
import { RequireScopes } from '../compliance/api-key.guard';
import { PrismaReadService } from './prisma-read.service';
import { PostgresPartitionService } from './postgres-partition.service';
import { ElasticRolloverService } from './elastic-rollover.service';
import { crawlProxyPoolStatus } from '../ingestion/crawl-proxy-pool';
import { resolveCrawlQueueName } from '../ingestion/crawl-queue-name';
import { QdrantService } from './qdrant.service';
import { ElasticService } from '../search/elastic.service';
import { QdrantBenchmarkService } from './qdrant-benchmark.service';
import { ScaleValidationService } from './scale-validation.service';
import { ClickhouseService } from '../analytics/clickhouse.service';
import { ElasticCcrService } from './elastic-ccr.service';
import { getServiceManifest } from '../config/service-manifest';

class EnsurePartitionsDto {
  @IsOptional()
  @IsIn(['RankingItemHistory', 'CrawledUrl'])
  table?: 'RankingItemHistory' | 'CrawledUrl';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  monthsAhead?: number;
}

class RolloverDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  maxDocs?: number;

  @IsOptional()
  maxAge?: string;
}

class BenchmarkDto {
  @IsOptional()
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  iterations?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class ValidationSuiteDto {
  @IsOptional()
  esQuery?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  esIterations?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  qdrantIterations?: number;
}

@Controller('admin/scale')
@RequireScopes('admin')
export class ScaleAdminController {
  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly partitions: PostgresPartitionService,
    private readonly rollover: ElasticRolloverService,
    private readonly qdrant: QdrantService,
    private readonly elastic: ElasticService,
    private readonly qdrantBench: QdrantBenchmarkService,
    private readonly validation: ScaleValidationService,
    private readonly clickhouse: ClickhouseService,
    private readonly ccr: ElasticCcrService,
  ) {}

  @Get('status')
  async status() {
    const qdrantPing = await this.qdrant.ping();
    return toPlainJson({
      postgres: {
        readReplicaConfigured: this.prismaRead.usesReadReplica,
        databaseReadUrlSet: Boolean(process.env.DATABASE_READ_URL?.trim()),
      },
      elasticsearch: {
        nodeConfigured: Boolean(process.env.ELASTICSEARCH_NODE?.trim()),
        entitiesIndex: process.env.ELASTICSEARCH_INDEX_ENTITIES ?? 'ranking_entities',
        crawledUrlsIndex:
          process.env.ELASTICSEARCH_INDEX_CRAWLED_URLS ?? 'ranking_crawled_urls',
      },
      qdrant: { ...this.qdrant.status(), ping: qdrantPing },
      objectStorage: {
        minioConfigured: Boolean(process.env.MINIO_ENDPOINT?.trim()),
        bucket: process.env.MINIO_BUCKET ?? null,
      },
      crawl: {
        queueName: resolveCrawlQueueName(),
        proxyPool: crawlProxyPoolStatus(),
        semanticDedupCrossSource: process.env.CRAWL_SEMANTIC_DEDUP_CROSS_SOURCE === 'true',
        workerShard: process.env.CRAWL_QUEUE_SHARD?.trim() || null,
        schedulerRegion: process.env.CRAWL_SCHEDULER_REGION?.trim() || null,
        schedulerDisabled: process.env.CRAWL_SCHEDULER_DISABLED === 'true',
      },
      elasticsearchScale: this.elastic.scaleHints(),
      serviceManifest: getServiceManifest(),
    });
  }

  @Post('elasticsearch/ensure-templates')
  async ensureEsTemplates() {
    return toPlainJson(await this.elastic.ensureBillionScaleTemplates());
  }

  @Post('postgres/ensure-partitions')
  async ensurePartitions(@Body() body: EnsurePartitionsDto) {
    if (body.table) {
      const result = await this.partitions.ensureMonthlyPartitions({
        table: body.table,
        monthsAhead: body.monthsAhead,
      });
      return toPlainJson(result);
    }
    const results = await this.partitions.ensureAllMonthlyPartitions(body.monthsAhead);
    return toPlainJson({ results });
  }

  @Post('clickhouse/ensure-tier')
  async ensureClickhouseTier() {
    return toPlainJson(await this.clickhouse.ensureTierPolicy());
  }

  @Get('clickhouse/tier-status')
  async clickhouseTierStatus() {
    return toPlainJson(await this.clickhouse.queryTierStatus());
  }

  @Get('elasticsearch/ccr-status')
  async esCcrStatus() {
    return toPlainJson(await this.ccr.getCcrStatus());
  }

  @Post('elasticsearch/bootstrap-ccr')
  async esBootstrapCcr() {
    return toPlainJson(await this.ccr.bootstrapAutoFollow());
  }

  @Post('elasticsearch/rollover-entities')
  async rolloverEntities(@Body() body: RolloverDto) {
    return toPlainJson(await this.rollover.rolloverEntities(body.maxDocs, body.maxAge));
  }

  @Post('elasticsearch/rollover-crawled-urls')
  async rolloverCrawledUrls(@Body() body: RolloverDto) {
    return toPlainJson(await this.rollover.rolloverCrawledUrls(body.maxDocs, body.maxAge));
  }

  @Get('elasticsearch/stats')
  async esStats() {
    return toPlainJson(await this.rollover.indexStats());
  }

  @Post('elasticsearch/bootstrap-aliases')
  async bootstrapAliases() {
    return toPlainJson(await this.rollover.bootstrapWriteAliases());
  }

  @Post('elasticsearch/ensure-ilm')
  async ensureIlm() {
    return toPlainJson(await this.rollover.ensureIlmPolicies());
  }

  @Get('elasticsearch/ilm-status')
  async ilmStatus() {
    return toPlainJson(await this.rollover.getIlmStatus());
  }

  @Post('elasticsearch/bootstrap-ilm-indices')
  async bootstrapIlmIndices() {
    return toPlainJson(await this.rollover.bootstrapIlmIndices());
  }

  @Post('elasticsearch/benchmark')
  async esBenchmark(@Body() body: BenchmarkDto) {
    return toPlainJson(
      await this.rollover.benchmarkEntitySearch(body.query, body.iterations),
    );
  }

  @Post('qdrant/benchmark')
  async qdrantBenchmark(@Body() body: BenchmarkDto) {
    return toPlainJson(
      await this.qdrantBench.run({
        query: body.query,
        iterations: body.iterations,
        limit: body.limit,
      }),
    );
  }

  @Post('validate')
  async validateSuite(@Body() body: ValidationSuiteDto) {
    return toPlainJson(await this.validation.runSuite(body));
  }
}
