import { describe, expect, it, vi } from 'vitest';
import { RankingAgent } from './ranking.agent';

describe('RankingAgent', () => {
  it('computes coverage gaps from EntityMetric', async () => {
    const prisma = {
      topicRankSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1n,
          items: [
            {
              entityId: 100n,
              entity: { canonicalName: 'Alice' },
            },
          ],
          topicRanking: {
            topicVersion: {
              policyJson: {
                weights: { streams: 0.5, mentions: 0.5 },
                requiredSignalKeys: ['streams', 'mentions'],
              },
            },
          },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      entityMetric: {
        findMany: vi.fn().mockResolvedValue([
          { entityId: 100n, metricKey: 'streams' },
        ]),
      },
      aiAnalysis: {
        create: vi.fn().mockResolvedValue({
          id: 5n,
          summary: 'coverage test',
        }),
      },
    };

    const agent = new RankingAgent(prisma as never);
    const out = await agent.run({ snapshotId: '1', topN: 5 });

    expect(out.coverageRatio).toBe(0.5);
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0].missingKeys).toContain('mentions');
  });
});
