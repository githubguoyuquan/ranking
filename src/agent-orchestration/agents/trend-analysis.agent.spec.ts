import { describe, expect, it, vi } from 'vitest';
import { TrendAnalysisAgent } from './trend-analysis.agent';

describe('TrendAnalysisAgent', () => {
  it('writes AiAnalysis when snapshot exists without TrendAnalysis row', async () => {
    const prisma = {
      topicRankSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1n,
          topicRanking: {
            timeWindow: 'WEEK',
            topicVersion: { topicId: 10n },
          },
        }),
      },
      trendAnalysis: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiAnalysis: {
        create: vi.fn().mockResolvedValue({
          id: 99n,
          summary: '快照 #1 趋势分析：暂无标签分布。涨榜：无显著涨榜；跌榜：无显著跌榜。',
        }),
      },
    };

    const agent = new TrendAnalysisAgent(prisma as never);
    const out = await agent.run({ snapshotId: '1' });

    expect(out.snapshotId).toBe('1');
    expect(out.aiAnalysisId).toBe('99');
    expect(out.summary).toContain('快照 #1');
    expect(prisma.aiAnalysis.create).toHaveBeenCalledOnce();
  });
});
