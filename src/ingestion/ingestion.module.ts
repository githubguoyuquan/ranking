import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { CrawlHostThrottleService } from './crawl-host-throttle.service';
import { CRAWL_QUEUE } from './crawl-job';
import { CrawlProcessor } from './crawl.processor';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: CRAWL_QUEUE,
    }),
    SearchModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService, CrawlProcessor, CrawlHostThrottleService],
  exports: [IngestionService],
})
export class IngestionModule {}
