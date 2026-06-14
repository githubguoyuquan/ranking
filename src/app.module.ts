import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { bullMqConnectionFromEnv } from './config/redis';
import { AiAuditModule } from './ai-audit/ai-audit.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ScaleModule } from './scale/scale.module';
import { AgentModule } from './agent/agent.module';
import { AgentOrchestrationModule } from './agent-orchestration/agent-orchestration.module';
import { BiModule } from './bi/bi.module';
import { ObservabilityModule } from './observability/observability.module';
import { OpsModule } from './ops/ops.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CacheModule } from './cache/cache.module';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { KafkaModule } from './kafka/kafka.module';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';
import { RankingsModule } from './rankings/rankings.module';
import { SearchModule } from './search/search.module';
import { SiteModule } from './site/site.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: bullMqConnectionFromEnv(),
    }),
    CacheModule,
    AiAuditModule,
    KafkaModule,
    PrismaModule,
    AnalyticsModule,
    OutboxModule,
    AgentModule,
    AgentOrchestrationModule,
    IngestionModule,
    RankingsModule,
    SearchModule,
    ScaleModule,
    ComplianceModule,
    BiModule,
    ObservabilityModule,
    OpsModule,
    SiteModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
