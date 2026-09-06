import { CrawlMonitorController } from './crawl-monitor.controller';
import { CrawlMonitorQuery } from './queries/crawl-monitor.query';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { runsCrawlScheduler, runsCrawlWorkers } from '../config/process-role';
import { AgentOrchestrationModule } from '../agent-orchestration/agent-orchestration.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SearchModule } from '../search/search.module';
import { CrawlAdminController } from './crawl-admin.controller';
import { CrawlHostThrottleService } from './crawl-host-throttle.service';
import { CRAWL_QUEUE } from './crawl-job';
import { CrawlProcessor } from './crawl.processor';
import { CrawlRegionalQueueService } from './crawl-regional-queue.service';
import { CrawlSchedulerAdminController } from './crawl-scheduler-admin.controller';
import { CrawlSchedulerService } from './crawl-scheduler.service';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { CrawlSignalExtractService } from './crawl-signal-extract.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: CRAWL_QUEUE,
    }),
    SearchModule,
    AgentOrchestrationModule,
    ObservabilityModule,
  ],
  controllers: [CrawlMonitorController, IngestionController, CrawlSchedulerAdminController, CrawlAdminController],
  providers: [
    CrawlMonitorQuery,
    IngestionService,
    CrawlSignalExtractService,
    CrawlRegionalQueueService,
    ...(runsCrawlWorkers() ? [CrawlProcessor] : []),
    ...(runsCrawlScheduler() ? [CrawlSchedulerService] : []),
    CrawlHostThrottleService,
  ],
  exports: [IngestionService, CrawlRegionalQueueService],
})
export class IngestionModule {}
