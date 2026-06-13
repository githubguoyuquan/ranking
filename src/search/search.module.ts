import { Module } from '@nestjs/common';
import { runsOutboxSideEffectFlushers } from '../config/process-role';
import { AiAuditModule } from '../ai-audit/ai-audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ElasticCrawledUrlOutboxFlusherService } from './elastic-crawled-url-outbox-flusher.service';
import { ElasticEntityOutboxFlusherService } from './elastic-entity-outbox-flusher.service';
import { ElasticService } from './elastic.service';
import { EmbeddingService } from './embedding.service';
import { QdrantSearchService } from './qdrant-search.service';
import { HybridSearchService } from './hybrid-search.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import { SearchController } from './search.controller';

@Module({
  imports: [PrismaModule, AiAuditModule],
  controllers: [SearchController, RecommendationsController],
  providers: [
    EmbeddingService,
    ElasticService,
    QdrantSearchService,
    HybridSearchService,
    RecommendationsService,
    ...(runsOutboxSideEffectFlushers()
      ? [ElasticEntityOutboxFlusherService, ElasticCrawledUrlOutboxFlusherService]
      : []),
  ],
  exports: [
    ElasticService,
    QdrantSearchService,
    EmbeddingService,
    HybridSearchService,
    RecommendationsService,
  ],
})
export class SearchModule {}
