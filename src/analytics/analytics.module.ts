import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { ClickhouseOutboxFlusherService } from './clickhouse-outbox-flusher.service';
import { ClickhouseService } from './clickhouse.service';

@Module({
  providers: [ClickhouseService, ClickhouseOutboxFlusherService],
  controllers: [AnalyticsController],
  exports: [ClickhouseService],
})
export class AnalyticsModule {}
