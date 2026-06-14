import { describe, expect, it, vi } from 'vitest';
import { RankingsService } from './rankings.service';

type ListHotBoardsResult = {
  filter: {
    topicsLimit: number;
    previewLimit: number;
    timeWindow: string | null;
  };
  count: number;
  boards: Array<{
    topic: { slug: string };
    snapshot: {
      preview: Array<{
        entity: { canonicalName: string };
      }>;
    };
  }>;
  generatedAt: string;
};

describe('RankingsService.listHotBoards', () => {
  it('returns preview rows capped by previewLimit and skips empty leaderboards', async () => {
    const readPrisma = {
      topic: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1n,
            slug: 'demo-a',
            title: 'Demo A',
            kind: 'GENERAL',
            tenantId: null,
          },
          {
            id: 2n,
            slug: 'demo-b',
            title: 'Demo B',
            kind: 'GENERAL',
            tenantId: null,
          },
        ]),
      },
    };

    const getLeaderboardForApi = vi
      .fn()
      .mockResolvedValueOnce({
        resolved: { timeWindow: 'DAY', topicVersion: 'v1' },
        snapshot: {
          id: '100',
          snapshotTime: '2026-06-12T08:00:00.000Z',
          items: [
            {
              rank: 1,
              rankChange: -2,
              popularityScore: 0.9,
              entity: { id: '10', canonicalName: 'Alpha' },
            },
            {
              rank: 2,
              rankChange: 1,
              popularityScore: 0.8,
              entity: { id: '11', canonicalName: 'Beta' },
            },
            {
              rank: 3,
              rankChange: null,
              popularityScore: 0.7,
              entity: { id: '12', canonicalName: 'Gamma' },
            },
          ],
        },
      })
      .mockResolvedValueOnce({ resolved: null, snapshot: { id: '200', items: [] } });

    const svc = {
      readPrisma,
      getLeaderboardForApi,
    } as unknown as RankingsService;

    const result = (await RankingsService.prototype.listHotBoards.call(svc, {
      topicsLimit: 5,
      previewLimit: 2,
      timeWindow: 'DAY',
    })) as ListHotBoardsResult;

    expect(result.count).toBe(1);
    expect(result.boards).toHaveLength(1);
    expect(result.boards[0].topic.slug).toBe('demo-a');
    expect(result.boards[0].snapshot.preview).toHaveLength(2);
    expect(result.boards[0].snapshot.preview[0].entity.canonicalName).toBe('Alpha');
    expect(result.filter).toEqual({
      topicsLimit: 5,
      previewLimit: 2,
      timeWindow: 'DAY',
    });
    expect(getLeaderboardForApi).toHaveBeenCalledTimes(2);
    expect(getLeaderboardForApi).toHaveBeenCalledWith(
      'demo-a',
      { timeWindow: 'DAY', includeAiStats: false },
      undefined,
    );
  });

  it('clamps topicsLimit and previewLimit', async () => {
    const readPrisma = {
      topic: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const svc = {
      readPrisma,
      getLeaderboardForApi: vi.fn(),
    } as unknown as RankingsService;

    const result = (await RankingsService.prototype.listHotBoards.call(svc, {
      topicsLimit: 99,
      previewLimit: 99,
    })) as ListHotBoardsResult;

    expect(result.filter.topicsLimit).toBe(30);
    expect(result.filter.previewLimit).toBe(20);
    expect(result.boards).toEqual([]);
  });
});
