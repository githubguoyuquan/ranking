export const CRAWL_QUEUE_BASE = 'crawl';

/** BullMQ 队列分片：`CRAWL_QUEUE_SHARD=eu-west` → `crawl:eu-west` */
export function resolveCrawlQueueName(): string {
  const shard = process.env.CRAWL_QUEUE_SHARD?.trim();
  if (!shard) return CRAWL_QUEUE_BASE;
  return `${CRAWL_QUEUE_BASE}:${shard}`;
}
