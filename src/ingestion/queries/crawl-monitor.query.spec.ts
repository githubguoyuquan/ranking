import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrawlMonitorQuery } from './crawl-monitor.query';
import { CrawlMonitorDto } from '../crawl-monitor.controller';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestContext } from '../../compliance/compliance-auth.types';
const auth = { tenantId: 7n, scopes: ['admin'] } as AuthenticatedRequestContext;
function setup(source: object | null = { id: 1n, name: 'A' }) {
  const prisma = { source: { findFirst: vi.fn().mockResolvedValue(source) }, crawledUrl: { findMany: vi.fn().mockResolvedValue([]) },
    crawlTask: { findMany: vi.fn().mockResolvedValue([{ id: 2n, sourceId: 1n, status: 'running' }]), findFirst: vi.fn().mockResolvedValue(null) } };
  return { prisma, query: new CrawlMonitorQuery(prisma as unknown as PrismaService) };
}
describe('crawl monitor aggregation', () => {
  it('reuses the watched row and projects only bounded display fields', async () => {
    const { prisma, query } = setup();
    const result = await query.get({ watchTaskId: '2', urlsLimit: 99, tasksLimit: 99 }, auth);
    expect(result).toMatchObject({ watchedTask: { data: { id: '2', status: 'running' } } });
    expect(prisma.crawlTask.findFirst).not.toHaveBeenCalled();
    expect(prisma.source.findFirst.mock.calls[0][0].where).toEqual({ tenantId: 7n });
    expect(prisma.crawledUrl.findMany.mock.calls[0][0].take).toBe(50);
    expect(prisma.crawlTask.findMany.mock.calls[0][0].take).toBe(30);
    expect(prisma.crawledUrl.findMany.mock.calls[0][0].select).not.toHaveProperty('body');
  });
  it('keeps empty source distinct from failed or forbidden source/task selection', async () => {
    const { prisma, query } = setup(null);
    expect(await query.get({}, auth)).toMatchObject({ selectedSource: null, urls: { status: 'empty' }, tasks: { status: 'empty' } });
    expect(prisma.crawlTask.findMany).not.toHaveBeenCalled();
    await expect(query.get({ sourceId: '9' }, auth)).rejects.toBeInstanceOf(NotFoundException);
    await expect(query.get({ watchTaskId: '8' }, auth)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.crawlTask.findFirst.mock.calls[0][0].where).toEqual({ id: 8n, source: { tenantId: 7n } });
  });
  it('isolates one failed section', async () => {
    const { prisma, query } = setup(); prisma.crawledUrl.findMany.mockRejectedValue(new Error('offline'));
    expect(await query.get({}, auth)).toMatchObject({ urls: { status: 'unavailable' }, tasks: { status: 'ok' }, meta: { partial: true } });
  });
  it('does not discard source lists when only a separate watched-task lookup fails', async () => {
    const { prisma, query } = setup(); prisma.crawlTask.findFirst.mockRejectedValue(new Error('offline'));
    expect(await query.get({ watchTaskId: '99' }, auth)).toMatchObject({ tasks: { status: 'ok' }, watchedTask: { status: 'unavailable' }, meta: { partial: true } });
  });
  it('rejects invalid IDs and excessive limits at the HTTP boundary', async () => {
    const dto = plainToInstance(CrawlMonitorDto, { sourceId: '-1', tasksLimit: '31', urlsLimit: '51' });
    expect((await validate(dto)).map(e => e.property).sort()).toEqual(['sourceId', 'tasksLimit', 'urlsLimit']);
    expect(await validate(plainToInstance(CrawlMonitorDto, { sourceId: '1', tasksLimit: '12' }))).toEqual([]);
  });
});
