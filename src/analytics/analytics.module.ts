import { Module } from '@nestjs/common';
import { runsOutboxSideEffectFlushers } from '../config/process-role';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsController } from './analytics.controller';
import { ClickhouseOutboxFlusherService } from './clickhouse-outbox-flusher.service';
import { ClickhouseService } from './clickhouse.service';

@Module({
  imports: [PrismaModule],
  providers: [
    ClickhouseService,
    ...(runsOutboxSideEffectFlushers() ? [ClickhouseOutboxFlusherService] : []),
  ],
  controllers: [AnalyticsController],
  exports: [ClickhouseService],
})
export class AnalyticsModule {}
