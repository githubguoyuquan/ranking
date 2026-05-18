import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
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

  /** 基于 TopicEmbedding / OpenAI 的余弦相似话题（首次会批量灌库） */
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

  /** Elasticsearch kNN 相似实体（需索引中含 embedding） */
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
}
