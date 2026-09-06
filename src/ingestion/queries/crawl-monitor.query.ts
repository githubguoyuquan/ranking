import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestContext } from '../../compliance/compliance-auth.types';
import { querySection } from '../../lib/query/query-section';
import { toPlainJson } from '../../lib/json';

@Injectable()
export class CrawlMonitorQuery {
  constructor(private readonly prisma: PrismaService) {}
  async get(query: { sourceId?: string; watchTaskId?: string; urlsLimit?: number; tasksLimit?: number }, auth?: AuthenticatedRequestContext) {
    const scope = auth ? { tenantId: auth.tenantId } : {};
    const source = await this.prisma.source.findFirst({
      where: { ...scope, ...(query.sourceId ? { id: BigInt(query.sourceId) } : {}) },
      orderBy: { id: 'desc' }, select: { id: true, name: true },
    });
    if (!source && query.sourceId) throw new NotFoundException('source not found');
    const urlsLimit = Math.min(Math.max(query.urlsLimit ?? 20, 1), 50), tasksLimit = Math.min(Math.max(query.tasksLimit ?? 12, 1), 30);
    const [urls, tasks] = await Promise.all([
      querySection(async () => source ? this.prisma.crawledUrl.findMany({
        where: { sourceId: source.id }, orderBy: { id: 'desc' }, take: urlsLimit,
        select: { id: true, sourceId: true, url: true, status: true, fetchedAt: true, pageTitle: true, contentHash: true, duplicateOfId: true },
      }) : [], rows => rows.length === 0),
      querySection(async () => source ? this.prisma.crawlTask.findMany({
        where: { sourceId: source.id }, orderBy: { id: 'desc' }, take: tasksLimit,
        select: { id: true, sourceId: true, status: true, cursor: true, createdAt: true, updatedAt: true },
      }) : [], rows => rows.length === 0),
    ]);
    // Authorize an explicitly watched task even when no source is selected.
    const watchedTask = query.watchTaskId ? await querySection(async () => {
      const watched = tasks.data?.find(t => String(t.id) === query.watchTaskId) ?? await this.prisma.crawlTask.findFirst({
        where: { id: BigInt(query.watchTaskId!), source: scope },
        select: { id: true, sourceId: true, status: true, cursor: true, createdAt: true, updatedAt: true },
      });
      if (!watched) throw new NotFoundException('task not found');
      return watched;
    }) : undefined;
    return toPlainJson({ selectedSource: source, urls: { ...urls, limit: urlsLimit }, tasks: { ...tasks, limit: tasksLimit },
      ...(watchedTask ? { watchedTask } : {}),
      meta: { schemaVersion: 1, requestId: randomUUID(), generatedAt: new Date().toISOString(), partial: [urls, tasks, watchedTask].some(s => s?.status === 'unavailable') },
    });
  }
}
