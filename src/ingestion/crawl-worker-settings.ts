import { crawlTimeoutMs } from './http-fetch';

/** 多副本 horizontal scaling 下单 worker 并发（默认 6） */
export function crawlWorkerConcurrency(): number {
  const n = Number(process.env.CRAWL_WORKER_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 && n <= 64 ? Math.floor(n) : 6;
}

/**
 * BullMQ job 锁时长：应大于单次抓取最坏耗时，避免长页面 / Playwright 任务被误判 stalled。
 */
export function crawlJobLockDurationMs(): number {
  const override = Number(process.env.CRAWL_JOB_LOCK_MS);
  if (Number.isFinite(override) && override >= 60_000 && override <= 900_000) {
    return Math.floor(override);
  }
  return Math.min(600_000, crawlTimeoutMs() + 120_000);
}
