/** `OUTBOX_TYPE_CRAWL_URL_FETCHED` — Kafka 事件网（与 ES sync 并行） */
export type CrawlUrlFetchedOutboxPayload = {
  schemaVersion: 1;
  crawledUrlId: string;
  sourceId: string;
  url: string;
  status: string;
  contentHash: string | null;
  pageTitle: string | null;
  duplicateOfId: string | null;
  fetchedAt: string;
};

export function buildCrawlUrlFetchedOutboxPayload(args: {
  crawledUrlId: bigint;
  sourceId: bigint;
  url: string;
  status: string;
  contentHash: string | null;
  pageTitle: string | null;
  duplicateOfId: bigint | null;
  fetchedAt: Date;
}): CrawlUrlFetchedOutboxPayload {
  return {
    schemaVersion: 1,
    crawledUrlId: args.crawledUrlId.toString(),
    sourceId: args.sourceId.toString(),
    url: args.url,
    status: args.status,
    contentHash: args.contentHash,
    pageTitle: args.pageTitle,
    duplicateOfId: args.duplicateOfId?.toString() ?? null,
    fetchedAt: args.fetchedAt.toISOString(),
  };
}
