/** `OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC` 行 `payload` */
export type ElasticCrawledUrlSyncAction = 'upsert' | 'delete';

export type ElasticCrawledUrlSyncPayload = {
  schemaVersion: 1;
  action: ElasticCrawledUrlSyncAction;
  crawledUrlId: string;
};

export function buildElasticCrawledUrlSyncOutboxPayload(
  crawledUrlId: bigint,
  action: ElasticCrawledUrlSyncAction,
): ElasticCrawledUrlSyncPayload {
  return {
    schemaVersion: 1,
    action,
    crawledUrlId: crawledUrlId.toString(),
  };
}
