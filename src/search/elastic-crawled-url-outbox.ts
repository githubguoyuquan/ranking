import { OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC } from '../outbox/outbox.constants';

export type ElasticCrawledUrlSyncAction = 'upsert' | 'delete';

export type ElasticCrawledUrlSyncPayload = {
  schemaVersion: 1;
  action: ElasticCrawledUrlSyncAction;
  crawledUrlId: string;
};

/** 与 `CrawledUrl` 写操作放在同一 PG 事务内的 Outbox 行 */
export function elasticCrawledUrlSyncOutboxCreate(
  crawledUrlId: bigint,
  action: ElasticCrawledUrlSyncAction,
) {
  return {
    type: OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC,
    payload: {
      schemaVersion: 1 as const,
      action,
      crawledUrlId: crawledUrlId.toString(),
    } satisfies ElasticCrawledUrlSyncPayload,
  };
}
