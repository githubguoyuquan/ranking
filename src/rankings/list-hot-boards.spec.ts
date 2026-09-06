import { describe, expect, it, vi } from 'vitest';
import { RankingsService } from './rankings.service';

const at = new Date('2026-09-01T00:00:00Z');
function board(id: number, populated = true) {
  return { id: BigInt(id), slug: `topic-${id}`, title: 'Topic', kind: 'OBJECTIVE', tenantId: 7n,
    versions: [{ id: 10n, version: 'v2', rankings: populated ? [{ id: 20n, timeWindow: 'DAY', windowStart: at, windowEnd: at,
      snapshots: [{ id: 30n, snapshotTime: at, scoreModelId: null, _count: { items: 200 }, items: [
        { rank: 1, rankChange: 2, popularityScore: 9, entity: { id: 50n, canonicalName: 'Alice', piiLevel: 'HIGH' } },
        { rank: 2, rankChange: null, popularityScore: 8, entity: { id: 51n, canonicalName: 'Beta', piiLevel: 'NONE' } },
      ] }],
    }] : [] }],
  };
}
function service(rows = [board(1, false), board(2), board(3)]) {
  const readPrisma = { topic: { count: vi.fn().mockResolvedValue(12), findMany: vi.fn().mockResolvedValue(rows) } };
  const getLeaderboardForApi = vi.fn();
  const svc = { readPrisma, getLeaderboardForApi } as unknown as RankingsService;
  return { svc, readPrisma, getLeaderboardForApi };
}
describe('batched hot boards', () => {
  it('projects bounded previews and actual item counts without per-board full reads', async () => {
    const { svc, readPrisma, getLeaderboardForApi } = service();
    const raw = await RankingsService.prototype.listHotBoards.call(svc, { topicsLimit: 1, previewLimit: 2, timeWindow: 'DAY', offset: 4 });
    const result = raw as { boards: Array<{ snapshot: { itemCount: number; preview: Array<{ entity: { canonicalName: string } }> } }>; pagination: { nextOffset: number } };
    expect(result.boards).toHaveLength(1);
    expect(result.boards[0].snapshot.itemCount).toBe(200);
    expect(result.boards[0].snapshot.preview.map(p => p.entity.canonicalName)).toEqual(['A****', 'Beta']);
    expect(result.pagination.nextOffset).toBe(6); // skips the empty newest version, no duplicate next page
    expect(getLeaderboardForApi).not.toHaveBeenCalled();
    const args = readPrisma.topic.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
    expect(args.select.versions.take).toBe(1);
    const rankings = args.select.versions.select.rankings;
    expect(rankings.where).toMatchObject({ status: 'completed', timeWindow: 'DAY' });
    expect(rankings.select.snapshots.select.items.take).toBe(2);
    expect(rankings.select.snapshots.select.items.select.entity.select.piiLevel).toBe(true);
  });
  it('preserves realtime window semantics in the batched projection', async () => {
    const row = board(1); row.versions[0].rankings[0].timeWindow = 'REALTIME';
    const { svc } = service([row]);
    const result = await RankingsService.prototype.listHotBoards.call(svc, { timeWindow: 'REALTIME' }) as { boards: Array<{ resolved: object }> };
    expect(result.boards[0].resolved).toHaveProperty('realtimeSemantics');
  });
  it('bounds caller limits and handles exhausted pages', async () => {
    const { svc } = service([]);
    const result = await RankingsService.prototype.listHotBoards.call(svc, { topicsLimit: 99, previewLimit: 99 }) as { filter: object; pagination: object; boards: unknown[] };
    expect(result.filter).toMatchObject({ topicsLimit: 30, previewLimit: 20 });
    expect(result.boards).toEqual([]);
    expect(result.pagination).toMatchObject({ hasMore: false, nextOffset: null });
  });
});
