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

@Controller('admin/scale')
@RequireScopes('admin')
export class ScaleAdminController {
  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly partitions: PostgresPartitionService,
    private readonly rollover: ElasticRolloverService,
    private readonly qdrant: QdrantService,
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
      },
    });
  }

  @Post('postgres/ensure-partitions')
  async ensurePartitions(@Body() body: EnsurePartitionsDto) {
    const table = body.table ?? 'RankingItemHistory';
    const result = await this.partitions.ensureMonthlyPartitions({
      table,
      monthsAhead: body.monthsAhead,
    });
    return toPlainJson(result);
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
}
