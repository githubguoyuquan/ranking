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

@Module({
  imports: [SearchModule, AnalyticsModule],
  controllers: [ScaleAdminController],
  providers: [
    PrismaReadService,
    PostgresPartitionService,
    ElasticRolloverService,
    QdrantService,
    QdrantBenchmarkService,
    ScaleValidationService,
  ],
  exports: [
    PrismaReadService,
    PostgresPartitionService,
    ElasticRolloverService,
    QdrantService,
    QdrantBenchmarkService,
    ScaleValidationService,
  ],
})
export class ScaleModule {}
