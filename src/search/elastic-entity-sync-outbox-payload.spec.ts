import { describe, expect, it } from 'vitest';
import { buildElasticEntitySyncOutboxPayload } from './elastic-entity-sync-outbox-payload';

describe('buildElasticEntitySyncOutboxPayload', () => {
  it('builds upsert payload', () => {
    const p = buildElasticEntitySyncOutboxPayload(5n, 'upsert');
    expect(p).toEqual({
      schemaVersion: 1,
      action: 'upsert',
      entityId: '5',
    });
  });

  it('builds delete payload', () => {
    const p = buildElasticEntitySyncOutboxPayload(9n, 'delete');
    expect(p.action).toBe('delete');
    expect(p.entityId).toBe('9');
  });
});
