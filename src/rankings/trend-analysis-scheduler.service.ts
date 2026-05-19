import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 周期性话题趋势汇总（Phase A）：按话题聚合近 7 日快照级 TrendAnalysis。
 * 禁用：`TREND_ANALYSIS_CRON_DISABLED=true`
 */
@Injectable()
export class TrendAnalysisSchedulerService {
  private readonly logger = new Logger(TrendAnalysisSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 3 * * *', { timeZone: 'UTC' })
  async dailyPeriodicRollup(): Promise<void> {
    if (process.env.TREND_ANALYSIS_CRON_DISABLED === 'true') return;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);

    const topics = await this.prisma.topic.findMany({
      select: { id: true, slug: true },
      take: 200,
    });

    let written = 0;
    for (const topic of topics) {
      const rows = await this.prisma.trendAnalysis.findMany({
        where: {
          topicId: topic.id,
          entityId: null,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      if (rows.length === 0) continue;

      const dayKey = new Date().toISOString().slice(0, 10);
      const existing = await this.prisma.trendAnalysis.findFirst({
        where: {
          topicId: topic.id,
          entityId: null,
          payload: { path: ['kind'], equals: 'periodic_rollup' },
          createdAt: { gte: new Date(`${dayKey}T00:00:00.000Z`) },
        },
      });
      if (existing) continue;

      const payload: Prisma.InputJsonValue = {
        kind: 'periodic_rollup',
        utcDay: dayKey,
        topicSlug: topic.slug,
        snapshotAnalysesIncluded: rows.length,
        samples: rows.slice(0, 5).map((r) => ({
          id: r.id.toString(),
          window: r.window,
          createdAt: r.createdAt.toISOString(),
          payload: r.payload,
        })),
      };

      await this.prisma.trendAnalysis.create({
        data: {
          topicId: topic.id,
          entityId: null,
          window: 'WEEK',
          payload,
        },
      });
      written += 1;
    }

    if (written > 0) {
      this.logger.log(`periodic_rollup: wrote ${written} topic trend rows`);
    }
  }
}
