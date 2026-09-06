import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { KafkaModule } from '../kafka/kafka.module';
import { SearchModule } from '../search/search.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { HealthSummaryQuery } from './queries/health-summary.query';
@Module({ imports: [PrismaModule, CacheModule, KafkaModule, SearchModule, AnalyticsModule], providers: [HealthSummaryQuery], exports: [HealthSummaryQuery] })
export class HealthQueryModule {}
