import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { bullMqConnectionFromEnv } from '../config/redis';
import { CRAWL_QUEUE_BASE } from './crawl-queue-name';
import type { CrawlJobPayload } from './crawl-job';
import { CRAWL_JOB_NAME } from './crawl-job';

function queueNameForRegion(region?: string | null): string {
  const r = region?.trim();
  if (r) return `${CRAWL_QUEUE_BASE}:${r}`;
  const shard = process.env.CRAWL_QUEUE_SHARD?.trim();
  if (shard) return `${CRAWL_QUEUE_BASE}:${shard}`;
  return CRAWL_QUEUE_BASE;
}

@Injectable()
export class CrawlRegionalQueueService implements OnModuleDestroy {
  private readonly connection = bullMqConnectionFromEnv();
  private readonly queues = new Map<string, Queue<CrawlJobPayload>>();

  resolveQueueName(region?: string | null): string {
    return queueNameForRegion(region);
  }

  getQueue(region?: string | null): Queue<CrawlJobPayload> {
    const name = queueNameForRegion(region);
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue<CrawlJobPayload>(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  async addJob(
    region: string | null | undefined,
    payload: CrawlJobPayload,
    opts: {
      jobId: string;
      attempts?: number;
      backoff?: { type: 'exponential'; delay: number };
      removeOnComplete?: number;
      removeOnFail?: number;
    },
  ): Promise<void> {
    const queue = this.getQueue(region);
    await queue.add(CRAWL_JOB_NAME, payload, {
      jobId: opts.jobId,
      attempts: opts.attempts ?? 3,
      backoff: opts.backoff ?? { type: 'exponential', delay: 3000 },
      removeOnComplete: opts.removeOnComplete ?? 500,
      removeOnFail: opts.removeOnFail ?? 1000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}
