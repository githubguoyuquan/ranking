import { describe, expect, it, vi } from 'vitest';
import { TrendAnomalyService } from './trend-anomaly.service';

describe('TrendAnomalyService', () => {
  it('scanRecentAnomalies aggregates snapshot anomalies', async () => {
    const prisma = {
      trendAnalysis: {
        findMany: vi.fn().mockResolvedValue([
          {
            topicId: 1n,
            createdAt: new Date(),
            payload: {
              kind: 'snapshot_summary',
              snapshotId: '10',
              itemCount: 5,
              topRankGainers: [{ entityId: '2', canonicalName: 'X', rankChange: 12 }],
            },
          },
        ]),
      },
      topic: {
        findMany: vi.fn().mockResolvedValue([{ id: 1n, slug: 'demo' }]),
      },
      entityTopicStats: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const svc = new TrendAnomalyService(prisma as never, prisma as never);
    const scan = await svc.scanRecentAnomalies({ includeStreaks: false });
    expect(scan.anomalies.length).toBeGreaterThan(0);
    expect(scan.status).not.toBe('ok');
  });
});
