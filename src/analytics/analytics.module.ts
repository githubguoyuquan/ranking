import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsController } from './analytics.controller';
import { ClickhouseOutboxFlusherService } from './clickhouse-outbox-flusher.service';
import { ClickhouseService } from './clickhouse.service';

@Module({
  imports: [PrismaModule],
  providers: [ClickhouseService, ClickhouseOutboxFlusherService],
  controllers: [AnalyticsController],
  exports: [ClickhouseService],
})
export class AnalyticsModule {}
