import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KafkaEnvelopeV1 } from './config';
import { OutboxIdLedger, SnapshotNotifyHandler } from './handler';

const sampleEnvelope: KafkaEnvelopeV1 = {
  envelopeVersion: 1,
  type: 'ranking.snapshot.completed',
  payload: {
    schemaVersion: 1,
    snapshotId: '1',
    topicRankingId: '2',
    topicVersionId: '3',
    topicId: '4',
    topicVersionLabel: 'v1',
    timeWindow: 'WEEK',
    snapshotTime: '2026-05-17T00:00:00.000Z',
    snapshotVersion: '1.WEEK.x',
    itemCount: 1,
    confidenceScore: 0.5,
    hasScoreModel: false,
    scoreModelId: null,
  },
  meta: { outboxId: '100', createdAt: '2026-05-17T01:00:00.000Z' },
};

describe('SnapshotNotifyHandler', () => {
  it('dedupes by outboxId via ledger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'snap-notify-'));
    const ledgerPath = join(dir, 'ledger.jsonl');
    const handler = new SnapshotNotifyHandler(new OutboxIdLedger(ledgerPath), null);

    expect(await handler.handle(sampleEnvelope)).toBe('processed');
    expect(await handler.handle(sampleEnvelope)).toBe('duplicate');
    expect(handler.stats.processed).toBe(1);
    expect(readFileSync(ledgerPath, 'utf8').trim()).toBe('100');
  });
});
