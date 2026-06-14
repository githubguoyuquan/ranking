import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SearchModule } from '../search/search.module';
import { PrismaReadService } from './prisma-read.service';
import { PostgresPartitionService } from './postgres-partition.service';
import { ElasticRolloverService } from './elastic-rollover.service';
import { QdrantService } from './qdrant.service';
import { QdrantBenchmarkService } from './qdrant-benchmark.service';
import { ScaleValidationService } from './scale-validation.service';
import { ScaleAdminController } from './scale-admin.controller';
import { ElasticCcrService } from './elastic-ccr.service';
import { PostgresPartitionSchedulerService } from './postgres-partition-scheduler.service';

@Module({
  imports: [SearchModule, AnalyticsModule],
  controllers: [ScaleAdminController],
  providers: [
    PrismaReadService,
    PostgresPartitionService,
    PostgresPartitionSchedulerService,
    ElasticRolloverService,
    ElasticCcrService,
    QdrantService,
    QdrantBenchmarkService,
    ScaleValidationService,
  ],
  exports: [
    PrismaReadService,
    PostgresPartitionService,
    ElasticRolloverService,
    ElasticCcrService,
    QdrantService,
    QdrantBenchmarkService,
    ScaleValidationService,
  ],
})
export class ScaleModule {}
