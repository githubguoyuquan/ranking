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
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RequireScopes } from '../compliance/api-key.guard';
import { EntityMetricsService } from './entity-metrics.service';

function parseEntityIdParam(id: string): bigint {
  const s = id.trim();
  if (!/^\d+$/.test(s)) throw new BadRequestException('invalid entity id');
  try {
    return BigInt(s);
  } catch {
    throw new BadRequestException('invalid entity id');
  }
}

function parseTopicVersionIdParam(id: string): bigint {
  const s = id.trim();
  if (!/^\d+$/.test(s)) throw new BadRequestException('invalid topicVersionId');
  try {
    return BigInt(s);
  } catch {
    throw new BadRequestException('invalid topicVersionId');
  }
}

export class EntityMetricIngestRowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  metricKey!: string;

  @IsNumber()
  value!: number;

  @IsDateString()
  observedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  sourceTier?: number;
}

export class IngestEntityMetricsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EntityMetricIngestRowDto)
  metrics!: EntityMetricIngestRowDto[];

  /** 可选：ClickHouse 写入时使用的 topic_id（缺省 0） */
  @IsOptional()
  @IsString()
  topicId?: string;
}

export class EntityMetricsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  metricKey?: string;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  latestOnly?: boolean;
}

export class SignalPreviewQueryDto {
  @IsOptional()
  @IsDateString()
  asOf?: string;
}

/** EntityMetric 读取/写入与物化前信号预览。OpenAPI：`docs/openapi/entity-metrics.yaml` */
@Controller()
export class EntityMetricsController {
  constructor(private readonly entityMetrics: EntityMetricsService) {}

  /** 读取实体排行信号观测（默认最近 50 条；`latestOnly=true` 时按 metricKey 取最新） */
  @Get('v1/entities/:id/metrics')
  async listMetrics(@Param('id') id: string, @Query() query: EntityMetricsQueryDto) {
    const entityId = parseEntityIdParam(id);
    return this.entityMetrics.listEntityMetrics(entityId, {
      metricKey: query.metricKey,
      since: query.since ? new Date(query.since) : undefined,
      limit: query.limit,
      latestOnly: query.latestOnly === true,
    });
  }

  /** 批量写入 EntityMetric（外部管道 / 运营补数） */
  @Post('admin/entities/:id/metrics')
  @RequireScopes('admin')
  async ingestMetrics(@Param('id') id: string, @Body() body: IngestEntityMetricsDto) {
    const entityId = parseEntityIdParam(id);
    let topicId: bigint | undefined;
    if (body.topicId?.trim()) {
      try {
        topicId = BigInt(body.topicId.trim());
      } catch {
        throw new BadRequestException('invalid topicId');
      }
    }
    const rows = body.metrics.map((m) => ({
      metricKey: m.metricKey,
      value: m.value,
      observedAt: new Date(m.observedAt),
      unit: m.unit,
      sourceTier: m.sourceTier,
    }));
    return this.entityMetrics.ingestEntityMetrics(entityId, rows, { topicId });
  }

  /** 物化前预览 TopicVersion 下各实体信号覆盖率 */
  @Get('v1/topic-versions/:topicVersionId/signal-preview')
  async signalPreview(
    @Param('topicVersionId') topicVersionId: string,
    @Query() query: SignalPreviewQueryDto,
  ) {
    const tvId = parseTopicVersionIdParam(topicVersionId);
    return this.entityMetrics.previewTopicVersionSignals(
      tvId,
      query.asOf ? new Date(query.asOf) : undefined,
    );
  }
}
