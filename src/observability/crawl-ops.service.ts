import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  crawlLinkPolicyForOverview,
  crawlRuntimeFeatures,
  crawlWorkerRuntime,
} from '../ingestion/crawl-runtime-features';
import { resolveCrawlQueueName } from '../ingestion/crawl-queue-name';
import type { CrawlOpsMetrics } from './outbox-lag.service';
import { outboxLagThresholds } from './outbox-lag.config';

@Injectable()
export class CrawlOpsService {
  private cached?: { until: number; data: CrawlOpsMetrics };
  private running?: Promise<CrawlOpsMetrics>;
  constructor(private readonly prisma: PrismaService) {}

  async buildOverviewResponse(): Promise<Record<string, unknown>> {
    const m = await this.collectMetrics();
    return {
      sources: m.overview.sources,
      scheduledSources: m.overview.scheduledSources,
      tasks: m.overview.tasksAll,
      urlsByStatus: m.overview.urlsByStatus,
      recentTasks: m.overview.recentTasks,
      features: m.features,
      linkPolicy: m.linkPolicy,
      worker: m.worker,
      scheduler: {
        ...m.scheduler,
        sla: m.schedulerSla,
      },
      scheduleRuns: m.scheduleRuns,
      recentScheduleRuns: m.recentRuns,
      prometheus: {
        aligned: true,
        note: '与 GET /admin/observability/prometheus 中 ranking_crawl_* 指标同源',
      },
    };
  }

  async collectMetrics(): Promise<CrawlOpsMetrics> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.data;
    if (!this.running) {
      this.running = this.collectFresh().then(data => { this.cached = { until: Date.now() + 10000, data }; return data; });
      void this.running.then(() => { this.running = undefined; }, () => { this.running = undefined; });
    }
    return this.running;
  }

  private async collectFresh(): Promise<CrawlOpsMetrics> {
    const now = new Date();
    const since1h = new Date(now.getTime() - 3_600_000);
    const since24h = new Date(now.getTime() - 86_400_000);

    const [
      sourceCount,
      scheduledSources,
      taskRunningAll,
      taskFailedAll,
      taskQueuedAll,
      urlByStatus,
      recentTasks,
      lastRun,
      runsByStatus,
      activeQueued24h,
      activeRunning24h,
      failed24h,
      recentRuns,
      scheduledRegions,
    ] = await Promise.all([
      this.prisma.source.count(),
      this.prisma.source.count({ where: { scheduleEnabled: true } }),
      this.prisma.crawlTask.count({ where: { status: 'running' } }),
      this.prisma.crawlTask.count({ where: { status: 'failed' } }),
      this.prisma.crawlTask.count({ where: { status: 'queued' } }),
      this.prisma.crawledUrl.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.crawlTask.findMany({
        orderBy: { id: 'desc' },
        take: 5,
        select: { id: true, status: true, sourceId: true, createdAt: true },
      }),
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
      this.prisma.source.findMany({
        where: { scheduleEnabled: true, region: { not: null } },
        distinct: ['region'],
        select: { region: true },
      }),
    ]);

    const statusMap = Object.fromEntries(
      runsByStatus.map((r) => [r.status, r._count.id]),
    );

    const lastAt = lastRun?.scheduledAt ?? null;
    const lastAgeSec = lastAt
      ? Math.floor((now.getTime() - lastAt.getTime()) / 1000)
      : null;
    const staleMinutes = outboxLagThresholds().crawlSchedulerStaleMin;
    const schedulerHealthy =
      lastAgeSec == null ? scheduledSources === 0 : lastAgeSec <= staleMinutes * 60;

    const urlsByStatus = Object.fromEntries(
      urlByStatus.map((r) => [r.status, r._count._all]),
    );

    const workerRt = crawlWorkerRuntime();
    const regions = scheduledRegions
      .map((r) => r.region?.trim())
      .filter((r): r is string => Boolean(r));

    return {
      scheduler: {
        enabled: process.env.CRAWL_SCHEDULER_DISABLED !== 'true',
        region: process.env.CRAWL_SCHEDULER_REGION?.trim() || null,
        enabledSources: scheduledSources,
        lastScheduleRunAt: lastAt?.toISOString() ?? null,
        lastScheduleRunAgeSec: lastAgeSec,
      },
      schedulerSla: {
        staleAfterMinutes: staleMinutes,
        healthy: schedulerHealthy,
      },
      scheduleRuns: {
        scheduled1h: statusMap.scheduled ?? 0,
        skipped1h: statusMap.skipped_duplicate ?? 0,
        failed1h: statusMap.failed ?? 0,
      },
      crawlTasks: {
        activeQueued: activeQueued24h,
        activeRunning: activeRunning24h,
        failed24h,
      },
      overview: {
        sources: sourceCount,
        scheduledSources,
        tasksAll: {
          running: taskRunningAll,
          failed: taskFailedAll,
          queued: taskQueuedAll,
        },
        urlsByStatus,
        recentTasks: recentTasks.map((t) => ({
          id: t.id.toString(),
          sourceId: t.sourceId.toString(),
          status: t.status,
          createdAt: t.createdAt.toISOString(),
        })),
      },
      features: crawlRuntimeFeatures(),
      linkPolicy: crawlLinkPolicyForOverview(),
      worker: {
        queueShard: workerRt.queueShard,
        queueName: resolveCrawlQueueName(),
        processRole: workerRt.processRole,
        scheduledRegions: regions,
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
