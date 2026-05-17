import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CRAWL_QUEUE } from './crawl-job';
import { CrawlProcessor } from './crawl.processor';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: CRAWL_QUEUE,
    }),
  ],
  controllers: [IngestionController],
  providers: [IngestionService, CrawlProcessor],
  exports: [IngestionService],
})
export class IngestionModule {}
