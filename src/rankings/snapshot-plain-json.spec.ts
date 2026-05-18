import type { TopicRankSnapshot } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { toRankingSnapshotPlainJson } from './snapshot-plain-json';

function snap(partial: Partial<TopicRankSnapshot> & { items: unknown }): TopicRankSnapshot & {
  items: unknown;
} {
  return {
    id: BigInt(1),
    topicRankingId: BigInt(1),
    snapshotTime: new Date(),
    snapshotVersion: 'v',
    rankingJson: {},
    trendSummary: null,
    generatedByAi: false,
    confidenceScore: 0,
    scoreModelId: null,
    ...partial,
  } as TopicRankSnapshot & { items: unknown };
}

describe('toRankingSnapshotPlainJson', () => {
  it('stringifies bigints and sets hasScoreModel true when scoreModelId set', () => {
    const out = toRankingSnapshotPlainJson(
      snap({
        id: BigInt(3),
        scoreModelId: BigInt(9),
        items: [{ x: BigInt(2) }],
      }),
    );
    expect(out.id).toBe('3');
    expect(out.scoreModelId).toBe('9');
    expect(out.hasScoreModel).toBe(true);
    expect(Array.isArray(out.items)).toBe(true);
    expect((out.items as { x: string }[])[0].x).toBe('2');
  });

  it('hasScoreModel false when scoreModelId null', () => {
    const out = toRankingSnapshotPlainJson(
      snap({ scoreModelId: null, items: [] }),
    );
    expect(out.hasScoreModel).toBe(false);
  });
});
