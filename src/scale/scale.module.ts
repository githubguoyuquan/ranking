import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { PrismaReadService } from './prisma-read.service';
import { PostgresPartitionService } from './postgres-partition.service';
import { ElasticRolloverService } from './elastic-rollover.service';
import { QdrantService } from './qdrant.service';
import { ScaleAdminController } from './scale-admin.controller';

@Module({
  imports: [SearchModule],
  controllers: [ScaleAdminController],
  providers: [
    PrismaReadService,
    PostgresPartitionService,
    ElasticRolloverService,
    QdrantService,
  ],
  exports: [PrismaReadService, PostgresPartitionService, ElasticRolloverService, QdrantService],
})
export class ScaleModule {}
