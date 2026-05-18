import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RankingsService } from './rankings.service';
import {
  RANKING_FOLLOWUP_JOB_NAME,
  RANKING_FOLLOWUP_QUEUE,
  type RankingFollowupPayload,
} from './ranking-followup-job';

@Processor(RANKING_FOLLOWUP_QUEUE, { concurrency: 2 })
export class RankingFollowupProcessor extends WorkerHost {
  constructor(private readonly rankings: RankingsService) {
    super();
  }

  async process(
    job: Job<RankingFollowupPayload, unknown, string>,
  ): Promise<Record<string, unknown>> {
    if (job.name !== RANKING_FOLLOWUP_JOB_NAME) {
      return { skipped: true, reason: 'unknown job name', name: job.name };
    }
    return this.rankings.handleRankingFollowupJob(job.data);
  }
}
