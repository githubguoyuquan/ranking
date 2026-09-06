import { HealthQueryModule } from '../ops/health-query.module';
import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CacheModule } from '../cache/cache.module';
import { KafkaModule } from '../kafka/kafka.module';
import { RankingsModule } from '../rankings/rankings.module';
import { ScaleModule } from '../scale/scale.module';
import { SearchModule } from '../search/search.module';
import { ObservabilityModule } from '../observability/observability.module';
import { BiAdminController } from './bi-admin.controller';
import { BiService } from './bi.service';

@Module({
  imports: [
    HealthQueryModule,
    RankingsModule,
    AnalyticsModule,
    CacheModule,
    KafkaModule,
    SearchModule,
    ScaleModule,
    ObservabilityModule,
  ],
  controllers: [BiAdminController],
  providers: [BiService],
  exports: [BiService],
})
export class BiModule {}
