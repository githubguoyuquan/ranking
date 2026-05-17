import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CRAWL_JOB_NAME, CRAWL_QUEUE, type CrawlJobPayload } from './crawl-job';
import { IngestionService } from './ingestion.service';

@Processor(CRAWL_QUEUE, { concurrency: 6 })
export class CrawlProcessor extends WorkerHost {
  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<CrawlJobPayload>): Promise<void> {
    if (job.name !== CRAWL_JOB_NAME) return;
    await this.ingestion.processCrawlJob(job.data);
  }
}
