import { describe, expect, it } from 'vitest';
import { buildClickhouseRankingSnapshotOutboxPayload } from './clickhouse-ranking-snapshot-outbox-payload';

describe('buildClickhouseRankingSnapshotOutboxPayload', () => {
  it('stringifies snapshot id and sets schemaVersion 1', () => {
    const p = buildClickhouseRankingSnapshotOutboxPayload({
      snapshotId: 7n,
    });
    expect(p.schemaVersion).toBe(1);
    expect(p.snapshotId).toBe('7');
  });
});
