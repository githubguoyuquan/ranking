import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CrawlOpsMetrics } from './outbox-lag.service';

@Injectable()
export class CrawlOpsService {
  constructor(private readonly prisma: PrismaService) {}

  async collectMetrics(): Promise<CrawlOpsMetrics> {
    const now = new Date();
    const since1h = new Date(now.getTime() - 3_600_000);
    const since24h = new Date(now.getTime() - 86_400_000);

    const [
      enabledSources,
      lastRun,
      runsByStatus,
      activeQueued,
      activeRunning,
      failed24h,
      recentRuns,
    ] = await Promise.all([
      this.prisma.source.count({ where: { scheduleEnabled: true } }),
      this.prisma.crawlScheduleRun.findFirst({
        orderBy: { scheduledAt: 'desc' },
        select: { scheduledAt: true },
      }),
      this.prisma.crawlScheduleRun.groupBy({
        by: ['status'],
        where: { scheduledAt: { gte: since1h } },
        _count: { id: true },
      }),
      this.prisma.crawlTask.count({
        where: { status: 'queued', createdAt: { gte: since24h } },
      }),
      this.prisma.crawlTask.count({
        where: { status: 'running', updatedAt: { gte: since24h } },
      }),
      this.prisma.crawlTask.count({
        where: { status: 'failed', createdAt: { gte: since24h } },
      }),
      this.prisma.crawlScheduleRun.findMany({
        orderBy: { scheduledAt: 'desc' },
        take: 15,
        select: {
          id: true,
          sourceId: true,
          status: true,
          region: true,
          scheduledAt: true,
        },
      }),
    ]);

    const statusMap = Object.fromEntries(
      runsByStatus.map((r) => [r.status, r._count.id]),
    );

    const lastAt = lastRun?.scheduledAt ?? null;
    const lastAgeSec = lastAt
      ? Math.floor((now.getTime() - lastAt.getTime()) / 1000)
      : null;

    return {
      scheduler: {
        enabled: process.env.CRAWL_SCHEDULER_DISABLED !== 'true',
        region: process.env.CRAWL_SCHEDULER_REGION?.trim() || null,
        enabledSources,
        lastScheduleRunAt: lastAt?.toISOString() ?? null,
        lastScheduleRunAgeSec: lastAgeSec,
      },
      scheduleRuns: {
        scheduled1h: statusMap.scheduled ?? 0,
        skipped1h: statusMap.skipped_duplicate ?? 0,
        failed1h: statusMap.failed ?? 0,
      },
      crawlTasks: {
        activeQueued,
        activeRunning,
        failed24h,
      },
      recentRuns: recentRuns.map((r) => ({
        id: r.id.toString(),
        sourceId: r.sourceId.toString(),
        status: r.status,
        region: r.region,
        scheduledAt: r.scheduledAt.toISOString(),
      })),
    };
  }
}
