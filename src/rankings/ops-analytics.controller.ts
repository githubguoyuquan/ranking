import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TimeWindow } from '@prisma/client';
import { toPlainJson } from '../lib/json';
import { OpsAnalyticsService } from './ops-analytics.service';

function parseBigIntId(id: string, label: string): bigint {
  const s = id.trim();
  if (!/^\d+$/.test(s)) throw new BadRequestException(`invalid ${label}`);
  try {
    return BigInt(s);
  } catch {
    throw new BadRequestException(`invalid ${label}`);
  }
}

export class EntityTimelineQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  topicSlugs?: string;

  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  topicsLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pointsLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  metricsLimit?: number;
}

export class CompareTopicVersionsDto {
  @IsString()
  fromTopicVersionId!: string;

  @IsString()
  toTopicVersionId!: string;

  @IsOptional()
  @IsEnum(TimeWindow)
  timeWindow?: TimeWindow;

  @IsOptional()
  @Transform(({ value }) => value !== false && value !== 'false' && value !== '0')
  @IsBoolean()
  includeRankPreview?: boolean;
}

/**
 * 运营分析：实体多话题时间线、TopicVersion 策略 diff。
 * OpenAPI：`docs/openapi/ops-analytics.yaml`
 */
@Controller()
export class OpsAnalyticsController {
  constructor(private readonly opsAnalytics: OpsAnalyticsService) {}

  @Get('v1/entities/:id/timeline')
  async entityTimeline(@Param('id') id: string, @Query() query: EntityTimelineQueryDto) {
    const entityId = parseBigIntId(id, 'entity id');
    const topicSlugs = query.topicSlugs
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.opsAnalytics.getEntityTimeline(entityId, {
      topicSlugs,
      timeWindow: query.timeWindow,
      topicsLimit: query.topicsLimit,
      pointsLimit: query.pointsLimit,
      metricsLimit: query.metricsLimit,
    });
  }

  @Post('v1/topic-versions/compare')
  async compareTopicVersions(@Body() body: CompareTopicVersionsDto) {
    const fromId = parseBigIntId(body.fromTopicVersionId, 'fromTopicVersionId');
    const toId = parseBigIntId(body.toTopicVersionId, 'toTopicVersionId');
    return toPlainJson(
      await this.opsAnalytics.compareTopicVersions(fromId, toId, {
        timeWindow: body.timeWindow,
        includeRankPreview: body.includeRankPreview,
      }),
    );
  }
}
