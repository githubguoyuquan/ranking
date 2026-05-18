import { TimeWindow } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildRankingFollowupRequestedOutboxPayload } from './ranking-followup-requested-outbox-payload';

describe('buildRankingFollowupRequestedOutboxPayload', () => {
  it('serializes ids and snapshot time', () => {
    const p = buildRankingFollowupRequestedOutboxPayload({
      snapshotId: '10',
      topicRankingId: '2',
      topicVersionId: '3',
      topicId: '4',
      timeWindow: TimeWindow.DAY,
      snapshotTime: new Date('2026-05-17T15:00:00.000Z'),
    });
    expect(p.schemaVersion).toBe(1);
    expect(p.snapshotTime).toBe('2026-05-17T15:00:00.000Z');
    expect(p.timeWindow).toBe(TimeWindow.DAY);
  });
});
