import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ElasticCrawledUrlOutboxFlusherService } from './elastic-crawled-url-outbox-flusher.service';
import { ElasticEntityOutboxFlusherService } from './elastic-entity-outbox-flusher.service';
import { ElasticService } from './elastic.service';
import { EmbeddingService } from './embedding.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import { SearchController } from './search.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController, RecommendationsController],
  providers: [
    EmbeddingService,
    ElasticService,
    RecommendationsService,
    ElasticEntityOutboxFlusherService,
    ElasticCrawledUrlOutboxFlusherService,
  ],
  exports: [ElasticService, EmbeddingService, RecommendationsService],
})
export class SearchModule {}
