import { Controller, Get, Post, Query } from '@nestjs/common';
import { RequireScopes } from '../compliance/api-key.guard';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { CrawlSchedulerService } from './crawl-scheduler.service';

@Controller('admin/crawl/scheduler')
@RequireScopes('admin')
export class CrawlSchedulerAdminController {
  constructor(
    private readonly scheduler: CrawlSchedulerService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  status() {
    return toPlainJson(this.scheduler.status());
  }

  @Post('tick')
  async tickNow() {
    await this.scheduler.tick();
    return toPlainJson({ ok: true, ...this.scheduler.status() });
  }

  @Get('runs')
  async recentRuns(@Query('limit') limitRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 200);
    const rows = await this.prisma.crawlScheduleRun.findMany({
      orderBy: { scheduledAt: 'desc' },
      take: limit,
      include: {
        source: { select: { id: true, name: true, region: true, baseUrl: true } },
      },
    });
    return toPlainJson({
      total: rows.length,
      runs: rows.map((r) => ({
        id: r.id.toString(),
        sourceId: r.sourceId.toString(),
        sourceName: r.source.name,
        region: r.region,
        crawlTaskId: r.crawlTaskId?.toString() ?? null,
        status: r.status,
        detail: r.detail,
        scheduledAt: r.scheduledAt.toISOString(),
      })),
    });
  }
}
