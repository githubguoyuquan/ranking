import { Controller, Get, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { RequireScopes } from '../compliance/api-key.guard';
import { getAuthFromRequest } from '../compliance/request-auth';
import { CrawlMonitorQuery } from './queries/crawl-monitor.query';

export class CrawlMonitorDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/) @MaxLength(18)
  sourceId?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/) @MaxLength(18)
  watchTaskId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  urlsLimit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30)
  tasksLimit?: number;
}
@Controller('admin/crawl')
@RequireScopes('admin')
export class CrawlMonitorController {
  constructor(private readonly monitor: CrawlMonitorQuery) {}
  @Get('monitor')
  get(@Query() query: CrawlMonitorDto, @Req() req: Request) {
    return this.monitor.get(query, getAuthFromRequest(req));
  }
}
