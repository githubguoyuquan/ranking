import { describe, expect, it, vi } from 'vitest';
import { OpsAnalyticsService } from './ops-analytics.service';

describe('OpsAnalyticsService.compareTopicVersions', () => {
  it('diffs policies for two versions of same topic', async () => {
    const fromId = 1n;
    const toId = 2n;
    const prisma = {
      topicVersion: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: fromId,
            topicId: 10n,
            version: 'v1',
            effectiveFrom: new Date('2026-01-01'),
            effectiveTo: null,
            frozen: false,
            policyJson: { weights: { streams: 0.5, mentions: 0.5 } },
            topic: { id: 10n, slug: 'demo', title: 'Demo', kind: 'OBJECTIVE' },
          },
          {
            id: toId,
            topicId: 10n,
            version: 'v2',
            effectiveFrom: new Date('2026-02-01'),
            effectiveTo: null,
            frozen: false,
            policyJson: { weights: { streams: 0.7, social: 0.3 } },
            topic: { id: 10n, slug: 'demo', title: 'Demo', kind: 'OBJECTIVE' },
          },
        ]),
      },
      topicRanking: { findFirst: vi.fn().mockResolvedValue(null) },
      topicRankSnapshot: { findFirst: vi.fn() },
      rankingItem: { findMany: vi.fn() },
      entity: { findUnique: vi.fn() },
      entityMetric: { findMany: vi.fn() },
    };
    const readPrisma = {
      rankingItemHistory: { groupBy: vi.fn(), findMany: vi.fn() },
      entityTopicStats: { findMany: vi.fn() },
    };

    const svc = new OpsAnalyticsService(prisma as never, readPrisma as never);
    const out = (await svc.compareTopicVersions(fromId, toId, {
      includeRankPreview: false,
    })) as {
      topic: { slug: string };
      policyDiff: { unchanged: boolean; weightChanges: unknown[] };
      rankPreview: null;
    };

    expect(out.topic.slug).toBe('demo');
    expect(out.policyDiff.unchanged).toBe(false);
    expect(out.policyDiff.weightChanges.length).toBeGreaterThan(0);
    expect(out.rankPreview).toBeNull();
  });
});
