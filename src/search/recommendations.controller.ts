import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RequireScopes } from '../compliance/api-key.guard';
import { toPlainJson } from '../lib/json';
import { RecommendationsService } from './recommendations.service';

class SimilarTopicsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class SimilarEntitiesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class CollaborativeQueryDto {
  @IsOptional()
  @IsString()
  topicSlug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100)
  topN?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}

class SyncTopicVectorsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(16)
  @Max(512)
  batchSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  maxTopics?: number;
}

function parseBigIntParam(raw: string | undefined, label: string): bigint {
  if (raw === undefined || raw.trim() === '') {
    throw new BadRequestException(`missing ${label}`);
  }
  try {
    return BigInt(raw.trim());
  } catch {
    throw new BadRequestException(`invalid ${label}`);
  }
}

@Controller()
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  /** 基于 TopicEmbedding / OpenAI 的余弦相似话题（Qdrant 或 PG） */
  @Get('v1/recommendations/similar-topics')
  async similarTopics(
    @Query('topicId') topicIdRaw: string,
    @Query() query: SimilarTopicsQueryDto,
  ) {
    const topicId = parseBigIntParam(topicIdRaw, 'topicId');
    const limit = query.limit ?? 10;
    const hits = await this.recommendations.similarTopics(topicId, limit);
    return toPlainJson({ topicId: topicId.toString(), count: hits.length, hits });
  }

  /** Elasticsearch / Qdrant kNN 相似实体 */
  @Get('v1/recommendations/similar-entities')
  async similarEntities(
    @Query('entityId') entityIdRaw: string,
    @Query() query: SimilarEntitiesQueryDto,
  ) {
    const entityId = parseBigIntParam(entityIdRaw, 'entityId');
    const limit = query.limit ?? 10;
    const hits = await this.recommendations.similarEntities(entityId, limit);
    return toPlainJson({ entityId: entityId.toString(), count: hits.length, hits });
  }

  /** 同榜共现 Item-based 协同过滤实体推荐 */
  @Get('v1/recommendations/collaborative-entities')
  async collaborativeEntities(
    @Query('entityId') entityIdRaw: string,
    @Query() query: CollaborativeQueryDto,
  ) {
    const entityId = parseBigIntParam(entityIdRaw, 'entityId');
    const result = await this.recommendations.collaborativeEntities({
      entityId,
      topicSlug: query.topicSlug,
      topN: query.topN,
      limit: query.limit,
    });
    return toPlainJson(result);
  }

  /** 将 PG TopicEmbedding 批量同步至 Qdrant（更大规模 ANN） */
  @Post('admin/recommendations/sync-topic-vectors')
  @RequireScopes('admin')
  async syncTopicVectors(@Body() body: SyncTopicVectorsDto) {
    return toPlainJson(await this.recommendations.syncTopicVectorsToQdrant(body));
  }
}
