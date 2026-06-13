import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CacheModule } from '../cache/cache.module';
import { KafkaModule } from '../kafka/kafka.module';
import { ObservabilityModule } from '../observability/observability.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScaleModule } from '../scale/scale.module';
import { SearchModule } from '../search/search.module';
import { DrReadinessService } from './dr-readiness.service';
import { OpsAdminController } from './ops-admin.controller';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    KafkaModule,
    AnalyticsModule,
    SearchModule,
    ScaleModule,
    ObservabilityModule,
  ],
  controllers: [OpsAdminController],
  providers: [DrReadinessService],
  exports: [DrReadinessService],
})
export class OpsModule {}
