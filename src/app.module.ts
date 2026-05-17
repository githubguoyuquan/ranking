import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { bullMqConnectionFromEnv } from './config/redis';
import { AgentModule } from './agent/agent.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CacheModule } from './cache/cache.module';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { KafkaModule } from './kafka/kafka.module';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';
import { RankingsModule } from './rankings/rankings.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: bullMqConnectionFromEnv(),
    }),
    CacheModule,
    KafkaModule,
    PrismaModule,
    AnalyticsModule,
    OutboxModule,
    AgentModule,
    IngestionModule,
    RankingsModule,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
