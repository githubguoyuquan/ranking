import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ElasticCrawledUrlOutboxFlusherService } from './elastic-crawled-url-outbox-flusher.service';
import { ElasticEntityOutboxFlusherService } from './elastic-entity-outbox-flusher.service';
import { ElasticService } from './elastic.service';
import { SearchController } from './search.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [
    ElasticService,
    ElasticEntityOutboxFlusherService,
    ElasticCrawledUrlOutboxFlusherService,
  ],
  exports: [ElasticService],
})
export class SearchModule {}
