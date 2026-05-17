import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { bullMqConnectionFromEnv } from './config/redis';
import { HealthController } from './health.controller';
import { AnalyticsModule } from './analytics/analytics.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';
import { RankingsModule } from './rankings/rankings.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: bullMqConnectionFromEnv(),
    }),
    PrismaModule,
    AnalyticsModule,
    OutboxModule,
    IngestionModule,
    RankingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
