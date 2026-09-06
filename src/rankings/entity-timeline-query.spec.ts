import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OpsAnalyticsService } from './ops-analytics.service';
import { SnapshotAnalyzeService } from '../agent/snapshot-analyze.service';
import type { AiAuditService } from '../ai-audit/ai-audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PrismaReadService } from '../scale/prisma-read.service';
import type { AuthenticatedRequestContext } from '../compliance/compliance-auth.types';
import { rankingHistorySummary } from '../domain/ranking-history-summary';
const auth = { tenantId: 7n, scopes: ['read'] } as AuthenticatedRequestContext;
describe('entity timeline', () => {
  it('uses bounded batched topic/point queries and shared history summary', async () => {
    const points = [5, 3, 2].map((rank, i) => ({ id: BigInt(i), topicId: 2n, asOf: new Date(1000 * i), rank, score: 1, snapshotId: 3n, timeWindow: 'WEEK' }));
    const prisma = { entity: { findFirst: vi.fn().mockResolvedValue({ id: 1n, canonicalName: 'Alice', piiLevel: 'HIGH' }) },
      topic: { findMany: vi.fn().mockResolvedValue([{ id: 2n }]) }, entityMetric: { findMany: vi.fn().mockResolvedValue([]) } };
    const read = { $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 2n, slug: 'demo', title: 'Demo', pointCount: 3 }]).mockResolvedValueOnce(points),
      entityTopicStats: { findMany: vi.fn().mockResolvedValue([]) } };
    const query = new OpsAnalyticsService(prisma as unknown as PrismaService, read as unknown as PrismaReadService);
    const result = await query.getEntityTimeline(1n, { topicSlugs: ['demo'], timeWindow: 'WEEK', pointsLimit: 999 }, auth) as { entity: { canonicalName: string }; topicSeries: Array<{ summary: object }> };
    expect(result.entity.canonicalName).toBe('A****');
    expect(result.topicSeries[0].summary).toMatchObject(rankingHistorySummary(points)!);
    expect(read.$queryRaw).toHaveBeenCalledTimes(2);
    const selection = read.$queryRaw.mock.calls[0][0];
    expect(selection.sql).toContain('t."tenantId"'); expect(selection.values).toContain(7n);
    const batch = read.$queryRaw.mock.calls[1][0];
    expect(batch.sql).toContain('CROSS JOIN LATERAL'); expect(batch.values).toContain(200);
    expect(prisma.entity.findFirst.mock.calls[0][0].where).toEqual({ id: 1n, tenantId: 7n });
  });
  it('does no history work for an inaccessible entity', async () => {
    const read = { $queryRaw: vi.fn() };
    const query = new OpsAnalyticsService({ entity: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as PrismaService, read as unknown as PrismaReadService);
    await expect(query.getEntityTimeline(1n, {}, auth)).rejects.toBeInstanceOf(NotFoundException);
    expect(read.$queryRaw).not.toHaveBeenCalled();
  });
  it('marks materialized statistics as all-history scope and empty returned histories accurately', () => {
    expect(rankingHistorySummary([])).toBeNull();
    expect(rankingHistorySummary([{ rank: 4 }], { bestRank: 1, worstRank: 8, currentStreakUp: 2, currentStreakDown: 0 })).toMatchObject({ bestRank: 1, pointCount: 1, summaryScope: 'materialized_history' });
  });
  it('awaits authorization before reading separately paginated analyses', async () => {
    const prisma = { topicRankSnapshot: { findUnique: vi.fn().mockResolvedValue({ topicRanking: { topicVersion: { topic: { tenantId: 8n } } } }) }, aiAnalysis: { count: vi.fn() } };
    const query = new SnapshotAnalyzeService(prisma as unknown as PrismaService, {} as AiAuditService);
    await expect(query.listAnalyses(1n, {}, auth)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.aiAnalysis.count).not.toHaveBeenCalled();
  });
});
