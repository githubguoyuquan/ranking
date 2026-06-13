import { describe, expect, it, vi } from 'vitest';
import { EntityMetricsService } from './entity-metrics.service';

describe('EntityMetricsService', () => {
  it('previewTopicVersionSignals computes eligibility', async () => {
    const prisma = {
      topicVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: 10n,
          topicId: 1n,
          policyJson: {
            entityIds: ['100'],
            weights: { streams: 0.5, mentions: 0.5 },
            requiredSignalKeys: ['streams', 'mentions'],
          },
          topic: { id: 1n, kind: 'OBJECTIVE', slug: 'demo' },
        }),
      },
      entityMetric: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityId: 100n,
            metricKey: 'streams',
            value: 1,
            sourceTier: 1,
            observedAt: new Date('2026-05-10T00:00:00.000Z'),
          },
        ]),
      },
      entity: {
        findMany: vi.fn().mockResolvedValue([
          { id: 100n, canonicalName: 'Alice' },
        ]),
      },
    };

    const svc = new EntityMetricsService(prisma as never);
    const out = (await svc.previewTopicVersionSignals(
      10n,
      new Date('2026-05-17T12:00:00.000Z'),
    )) as {
      eligibleCount: number;
      excludedByMissingSignals: number;
      entities: Array<{ missingKeys: string[]; rankEligible: boolean }>;
    };

    expect(out.eligibleCount).toBe(0);
    expect(out.excludedByMissingSignals).toBe(1);
    expect(out.entities[0]?.missingKeys).toContain('mentions');
    expect(out.entities[0]?.rankEligible).toBe(false);
  });
});
