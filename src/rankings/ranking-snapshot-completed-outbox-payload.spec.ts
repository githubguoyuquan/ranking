import { TimeWindow } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  buildRankingSnapshotCompletedOutboxPayload,
  normalizeRankingSnapshotCompletedOutboxPayload,
} from './ranking-snapshot-completed-outbox-payload';

describe('buildRankingSnapshotCompletedOutboxPayload', () => {
  const base = {
    snapshotId: 10n,
    topicRankingId: 20n,
    topicVersionId: 30n,
    topicId: 40n,
    topicVersionLabel: 'v1',
    timeWindow: TimeWindow.DAY,
    snapshotTime: new Date('2026-05-17T12:00:00.000Z'),
    snapshotVersion: 'snap-ver',
    itemCount: 5,
    confidenceScore: 0.75,
  };

  it('sets hasScoreModel and string scoreModelId when model is present', () => {
    const p = buildRankingSnapshotCompletedOutboxPayload({
      ...base,
      scoreModelId: 99n,
    });
    expect(p.hasScoreModel).toBe(true);
    expect(p.scoreModelId).toBe('99');
    expect(p.schemaVersion).toBe(1);
    expect(p.snapshotId).toBe('10');
    expect(p.topicRankingId).toBe('20');
    expect(p.topicVersionId).toBe('30');
    expect(p.topicId).toBe('40');
    expect(p.snapshotTime).toBe('2026-05-17T12:00:00.000Z');
  });

  it('normalizes legacy payload missing hasScoreModel / scoreModelId', () => {
    const p = normalizeRankingSnapshotCompletedOutboxPayload({
      schemaVersion: 1,
      snapshotId: '1',
      topicRankingId: '2',
      topicVersionId: '3',
      topicId: '4',
      topicVersionLabel: '2026.05',
      timeWindow: 'WEEK',
      snapshotTime: '2026-05-10T00:00:00.000Z',
      snapshotVersion: '2026.05.WEEK.1',
      itemCount: 3,
      confidenceScore: 0.8,
    });
    expect(p?.hasScoreModel).toBe(false);
    expect(p?.scoreModelId).toBeNull();
  });

  it('sets hasScoreModel false and null scoreModelId when absent', () => {
    const p = buildRankingSnapshotCompletedOutboxPayload({
      ...base,
      scoreModelId: null,
    });
    expect(p.hasScoreModel).toBe(false);
    expect(p.scoreModelId).toBeNull();
  });
});
