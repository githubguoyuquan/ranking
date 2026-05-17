import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { ClickhouseService } from './clickhouse.service';

@Module({
  providers: [ClickhouseService],
  controllers: [AnalyticsController],
  exports: [ClickhouseService],
})
export class AnalyticsModule {}
