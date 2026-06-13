import { describe, expect, it } from 'vitest';
import { parseRankingSnapshotCompletedMessage } from './validate-envelope';

const validPayload = {
  schemaVersion: 1,
  snapshotId: '42',
  topicRankingId: '2',
  topicVersionId: '3',
  topicId: '4',
  topicVersionLabel: 'v1',
  timeWindow: 'WEEK',
  snapshotTime: '2026-05-17T00:00:00.000Z',
  snapshotVersion: '1.WEEK.x',
  itemCount: 5,
  confidenceScore: 0.88,
  hasScoreModel: false,
  scoreModelId: null,
};

describe('parseRankingSnapshotCompletedMessage', () => {
  it('accepts envelope v1 + ranking.snapshot.completed payload', () => {
    const envelope = {
      envelopeVersion: 1,
      type: 'ranking.snapshot.completed',
      payload: validPayload,
      meta: { outboxId: '99', createdAt: '2026-05-17T01:00:00.000Z' },
    };

    const out = parseRankingSnapshotCompletedMessage(JSON.stringify(envelope));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.envelope.payload.snapshotId).toBe('42');
      expect(out.envelope.meta.outboxId).toBe('99');
    }
  });

  it('rejects wrong event type', () => {
    const out = parseRankingSnapshotCompletedMessage(
      JSON.stringify({
        envelopeVersion: 1,
        type: 'crawl.url.fetched',
        payload: validPayload,
        meta: { outboxId: '1', createdAt: '2026-01-01T00:00:00.000Z' },
      }),
    );
    expect(out.ok).toBe(false);
  });
});
