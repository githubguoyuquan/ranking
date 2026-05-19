import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionService } from './ingestion.service';
import { isSourceScheduleDue } from './crawl-schedule-due';
import { CrawlRegionalQueueService } from './crawl-regional-queue.service';

const ACTIVE_STATUSES = ['queued', 'running'];

/**
 * 全球爬虫调度：按信源 `scheduleIntervalMinutes` / `scheduleCron` 与 `region` 入队 BullMQ。
 * 禁用：`CRAWL_SCHEDULER_DISABLED=true`
 * 区域过滤：`CRAWL_SCHEDULER_REGION=eu-west` 仅调度该区信源
 */
@Injectable()
export class CrawlSchedulerService {
  private readonly logger = new Logger(CrawlSchedulerService.name);
  private lastTickAt: Date | null = null;
  private lastTickScheduled = 0;
  private lastTickSkipped = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
    private readonly regionalQueue: CrawlRegionalQueueService,
  ) {}

  @Cron('* * * * *', { timeZone: 'UTC' })
  async tick(): Promise<void> {
    if (process.env.CRAWL_SCHEDULER_DISABLED === 'true') return;

    const now = new Date();
    const schedulerRegion = process.env.CRAWL_SCHEDULER_REGION?.trim();
    const dedupeMinutes = Math.max(
      1,
      Number.parseInt(process.env.CRAWL_SCHEDULER_DEDUPE_MINUTES ?? '30', 10) || 30,
    );
    const dedupeSince = new Date(now.getTime() - dedupeMinutes * 60_000);

    const sources = await this.prisma.source.findMany({
      where: {
        scheduleEnabled: true,
        ...(schedulerRegion ? { region: schedulerRegion } : {}),
      },
      orderBy: [{ schedulePriority: 'desc' }, { id: 'asc' }],
      take: 500,
    });

    let scheduled = 0;
    let skipped = 0;

    for (const source of sources) {
      if (!isSourceScheduleDue(source, now)) {
        skipped += 1;
        continue;
      }

      const active = await this.prisma.crawlTask.findFirst({
        where: {
          sourceId: source.id,
          status: { in: ACTIVE_STATUSES },
          createdAt: { gte: dedupeSince },
        },
        select: { id: true },
      });
      if (active) {
        await this.prisma.crawlScheduleRun.create({
          data: {
            sourceId: source.id,
            region: source.region,
            status: 'skipped_duplicate',
            detail: `active task ${active.id}`,
          },
        });
        skipped += 1;
        continue;
      }

      const checkpoint = await this.prisma.crawlCheckpoint.findUnique({
        where: { crawlerName: `source:${source.id.toString()}` },
      });

      try {
        const task = await this.ingestion.createCrawlTask({
          sourceId: source.id,
          async: true,
          crawlerName: `source:${source.id.toString()}`,
          cursor: checkpoint?.lastCursor ?? undefined,
          seedUrls: [source.baseUrl],
          queueRegion: source.region,
        });
        await this.prisma.source.update({
          where: { id: source.id },
          data: { lastScheduledAt: now },
        });
        await this.prisma.crawlScheduleRun.create({
          data: {
            sourceId: source.id,
            crawlTaskId: task.id,
            region: source.region,
            status: 'scheduled',
            detail: this.regionalQueue.resolveQueueName(source.region),
          },
        });
        scheduled += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.prisma.crawlScheduleRun.create({
          data: {
            sourceId: source.id,
            region: source.region,
            status: 'failed',
            detail: msg.slice(0, 2000),
          },
        });
        this.logger.warn(`schedule source ${source.id}: ${msg}`);
      }
    }

    this.lastTickAt = now;
    this.lastTickScheduled = scheduled;
    this.lastTickSkipped = skipped;
    if (scheduled > 0) {
      this.logger.log(
        `crawl scheduler: scheduled=${scheduled} skipped=${skipped} region=${schedulerRegion ?? 'all'}`,
      );
    }
  }

  status() {
    return {
      enabled: process.env.CRAWL_SCHEDULER_DISABLED !== 'true',
      schedulerRegion: process.env.CRAWL_SCHEDULER_REGION?.trim() || null,
      dedupeMinutes: Number.parseInt(process.env.CRAWL_SCHEDULER_DEDUPE_MINUTES ?? '30', 10) || 30,
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      lastTickScheduled: this.lastTickScheduled,
      lastTickSkipped: this.lastTickSkipped,
    };
  }
}
