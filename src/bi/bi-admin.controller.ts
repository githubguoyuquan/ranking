import { Controller, Get, Param, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { RequireScopes } from '../compliance/api-key.guard';
import { BiService } from './bi.service';

class BiDaysQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

@Controller('admin/bi')
@RequireScopes('admin')
export class BiAdminController {
  constructor(private readonly bi: BiService) {}

  /** BI 大屏聚合：KPI、健康、全球爬虫、ES 规模、CH 趋势、热点涨榜 */
  @Get('overview')
  overview(@Query() q: BiDaysQuery) {
    return this.bi.getOverview(q.days ?? 14);
  }

  @Get('timeseries/topics')
  topicTimeseries(@Query() q: BiDaysQuery) {
    return this.bi.getTopicTimeseries(q.days ?? 14);
  }

  @Get('entities/:entityId/rank-sparkline')
  entityRankSparkline(
    @Param('entityId') entityId: string,
    @Query() q: BiDaysQuery,
  ) {
    return this.bi.getEntityRankSparkline(BigInt(entityId), q.days ?? 30);
  }
}
