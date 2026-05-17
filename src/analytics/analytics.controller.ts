import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { randomUUID } from 'crypto';
import { ClickhouseService, type MetricTimeseriesRow } from './clickhouse.service';
import { toPlainJson } from '../lib/json';

class MetricPointDto {
  @IsString()
  metric_key!: string;

  @IsNumber()
  value!: number;

  @IsNumber()
  topic_id!: number;

  @IsNumber()
  entity_id!: number;
}

class InsertMetricsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetricPointDto)
  points!: MetricPointDto[];

  @IsOptional()
  @IsString()
  ts?: string;
}

@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly clickhouse: ClickhouseService) {}

  @Get('clickhouse/health')
  async clickhouseHealth() {
    return toPlainJson(await this.clickhouse.ping());
  }

  /** 手工灌测试数据（需 CLICKHOUSE_URL + 已建表） */
  @Post('clickhouse/metrics')
  async insertMetrics(@Body() body: InsertMetricsDto) {
    if (!this.clickhouse.isEnabled()) {
      return { ok: false, reason: 'ClickHouse disabled' };
    }
    const ts =
      body.ts ?? new Date().toISOString().replace('T', ' ').replace('Z', '');
    const ingested = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const rows: MetricTimeseriesRow[] = body.points.map((p) => ({
      ts,
      topic_id: p.topic_id,
      entity_id: p.entity_id,
      metric_key: p.metric_key,
      value: p.value,
      source_tier: 3,
      ingested_at: ingested,
      evidence_id: randomUUID(),
      snapshot_id: 0,
      time_window: 'CUSTOM',
    }));
    await this.clickhouse.insertMetricTimeseries(rows);
    return { ok: true, inserted: rows.length };
  }
}
