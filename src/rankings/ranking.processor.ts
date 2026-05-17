import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RankingsService } from './rankings.service';
import { RANKING_JOB_NAME, RANKING_QUEUE, type RankingJobPayload } from './ranking-job';

@Processor(RANKING_QUEUE, { concurrency: 4 })
export class RankingProcessor extends WorkerHost {
  constructor(private readonly rankings: RankingsService) {
    super();
  }

  async process(job: Job<RankingJobPayload, unknown, string>): Promise<Record<string, unknown>> {
    if (job.name !== RANKING_JOB_NAME) {
      return { skipped: true, reason: 'unknown job name', name: job.name };
    }
    const out = await this.rankings.processRankingJob(job.data);
    return out as Record<string, unknown>;
  }
}
