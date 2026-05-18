import { OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC } from '../outbox/outbox.constants';
import {
  buildElasticCrawledUrlSyncOutboxPayload,
  type ElasticCrawledUrlSyncAction,
} from './elastic-crawled-url-sync-outbox-payload';

export type {
  ElasticCrawledUrlSyncAction,
  ElasticCrawledUrlSyncPayload,
} from './elastic-crawled-url-sync-outbox-payload';

/** 与 `CrawledUrl` 写操作放在同一 PG 事务内的 Outbox 行 */
export function elasticCrawledUrlSyncOutboxCreate(
  crawledUrlId: bigint,
  action: ElasticCrawledUrlSyncAction,
) {
  return {
    type: OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC,
    payload: buildElasticCrawledUrlSyncOutboxPayload(crawledUrlId, action),
  };
}
