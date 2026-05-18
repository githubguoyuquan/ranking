import { describe, expect, it } from 'vitest';
import { buildElasticCrawledUrlSyncOutboxPayload } from './elastic-crawled-url-sync-outbox-payload';

describe('buildElasticCrawledUrlSyncOutboxPayload', () => {
  it('stringifies id and sets action', () => {
    const p = buildElasticCrawledUrlSyncOutboxPayload(42n, 'upsert');
    expect(p.schemaVersion).toBe(1);
    expect(p.crawledUrlId).toBe('42');
    expect(p.action).toBe('upsert');
  });
});
