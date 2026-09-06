import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RankingsService } from '../rankings.service';
import { SnapshotContextQuery } from './snapshot-context.query';
import { TopicRankingQuery } from './topic-ranking.query';
import { TopicOverviewQuery } from './topic-overview.query';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestContext } from '../../compliance/compliance-auth.types';
const auth: AuthenticatedRequestContext = { tenantId: 7n, tenantSlug: 'a', apiKeyId: 1n, apiKeyLabel: 'read', scopes: ['read'] };
const topicRanking = { topicVersion: { topic: { tenantId: 8n } } };
describe('authorized aggregation reads', () => {
  it('authorizes current snapshot ownership before reading cached content', async () => {
    const getSnapshotForApi = vi.fn();
    const svc = { prisma: { topicRankSnapshot: { findUnique: vi.fn().mockResolvedValue({ topicRanking }) } }, getSnapshotForApi } as unknown as RankingsService;
    await expect(RankingsService.prototype.getSnapshotForApiWithAuth.call(svc, 1n, { auth })).rejects.toBeInstanceOf(ForbiddenException);
    expect(getSnapshotForApi).not.toHaveBeenCalled();
  });
  it('caches raw content before per-request redaction', async () => {
    let cached: string | null = null;
    const loadSnapshotFull = vi.fn().mockResolvedValue({ id: 1n, items: [{ entity: { id: 2n, canonicalName: 'Alice', piiLevel: 'HIGH' } }] });
    const svc = { rankingCache: { getSnapshotJson: vi.fn(async () => cached), setSnapshotJson: vi.fn(async (_: bigint, json: string) => { cached = json; }) }, loadSnapshotFull } as unknown as RankingsService;
    const read = await RankingsService.prototype.getSnapshotForApi.call(svc, 1n, { scopes: ['read'] });
    expect(JSON.stringify(read)).not.toContain('Alice');
    const admin = await RankingsService.prototype.getSnapshotForApi.call(svc, 1n, { scopes: ['admin'] });
    expect(JSON.stringify(admin)).toContain('Alice');
    expect(loadSnapshotFull).toHaveBeenCalledOnce();
  });
  it('adds current AI counts without reloading cached ranking items or caching counts', async () => {
    const raw = JSON.stringify({ id: '1', items: [] });
    const stats = vi.fn().mockResolvedValueOnce({ aiAnalysisCount: 2 }).mockResolvedValueOnce({ aiAnalysisCount: 3 });
    const setSnapshotJson = vi.fn(), loadSnapshotFull = vi.fn();
    const svc = { rankingCache: { getSnapshotJson: vi.fn().mockResolvedValue(raw), setSnapshotJson }, loadSnapshotFull, aiAnalysisQuickStatsForSnapshot: stats } as unknown as RankingsService;
    expect(await RankingsService.prototype.getSnapshotForApi.call(svc, 1n, { includeAiStats: true })).toMatchObject({ aiAnalysisCount: 2 });
    expect(await RankingsService.prototype.getSnapshotForApi.call(svc, 1n, { includeAiStats: true })).toMatchObject({ aiAnalysisCount: 3 });
    expect(loadSnapshotFull).not.toHaveBeenCalled(); expect(setSnapshotJson).not.toHaveBeenCalled();
  });
  it('stops version and snapshot selection when topic is absent in tenant scope', async () => {
    const prisma = { topic: { findFirst: vi.fn().mockResolvedValue(null) }, topicVersion: { findFirst: vi.fn() } };
    await expect(new TopicRankingQuery(prisma as unknown as PrismaService).resolve('private', {}, auth)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.topic.findFirst).toHaveBeenCalledWith({ where: { slug: 'private', tenantId: 7n } });
    expect(prisma.topicVersion.findFirst).not.toHaveBeenCalled();
  });
  it('returns partial overview when only the recent-list read fails, with matching version/window', async () => {
    const at = new Date('2026-09-01Z');
    const context = { topic: { id: 1n, slug: 'demo', title: 'Demo', kind: 'OBJECTIVE' }, version: { id: 2n, version: 'v2' },
      ranking: { id: 3n, timeWindow: 'WEEK', windowStart: at, windowEnd: at }, snapshot: { id: 4n, snapshotTime: at, scoreModelId: null } };
    const resolve = vi.fn().mockResolvedValue(context);
    const findMany = vi.fn().mockRejectedValue(new Error('offline'));
    const getSnapshotForApiWithAuth = vi.fn().mockResolvedValue({ id: '4', items: [] });
    const query = new TopicOverviewQuery({ topicRankSnapshot: { findMany } } as unknown as PrismaService,
      { resolve } as unknown as TopicRankingQuery, { getSnapshotForApiWithAuth } as unknown as RankingsService);
    const raw = await query.get('demo', {}, auth) as { leaderboard: { status: string }; recentSnapshots: { status: string }; meta: { partial: boolean } };
    expect(resolve).toHaveBeenCalledOnce();
    expect(raw).toMatchObject({ leaderboard: { status: 'ok' }, recentSnapshots: { status: 'unavailable' }, meta: { partial: true } });
    expect(findMany.mock.calls[0][0].where).toEqual({ topicRanking: { topicVersionId: 2n, timeWindow: 'WEEK' } });
  });
  it('resolves neighbors only in the current ranking and does not query them on forbidden access', async () => {
    const current = { topicRankingId: 3n, snapshotTime: new Date(), topicRanking: { topicVersion: { topic: { tenantId: 7n } } } };
    const findUnique = vi.fn().mockResolvedValue(current), findFirst = vi.fn().mockResolvedValue(null);
    const query = new SnapshotContextQuery({ topicRankSnapshot: { findUnique, findFirst } } as unknown as PrismaService);
    expect(await query.neighbors(4n, auth)).toMatchObject({ data: { currentSnapshotId: '4', previous: null, next: null } });
    expect(findFirst.mock.calls.every(([args]) => args.where.topicRankingId === 3n)).toBe(true);
    findFirst.mockClear(); findUnique.mockResolvedValue({ ...current, topicRanking });
    await expect(query.neighbors(4n, auth)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
