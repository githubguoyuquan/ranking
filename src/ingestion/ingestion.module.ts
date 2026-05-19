import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { runsCrawlWorkers } from '../config/process-role';
import { AgentOrchestrationModule } from '../agent-orchestration/agent-orchestration.module';
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
    AgentOrchestrationModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    ...(runsCrawlWorkers() ? [CrawlProcessor] : []),
    CrawlHostThrottleService,
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
