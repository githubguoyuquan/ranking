import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildCrawlJobId,
  CRAWL_JOB_NAME,
  CRAWL_QUEUE,
  type CrawlJobPayload,
  urlFingerprint,
} from './crawl-job';

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CRAWL_QUEUE) private readonly crawlQueue: Queue<CrawlJobPayload>,
  ) {}

  async getCheckpoint(crawlerName: string) {
    return this.prisma.crawlCheckpoint.findUnique({
      where: { crawlerName },
    });
  }

  async upsertCheckpoint(
    crawlerName: string,
    body: {
      lastCursor?: string | null;
      lastUrl?: string | null;
      lastTopic?: string | null;
      lastProcessed?: Date | null;
      meta?: Prisma.InputJsonValue;
    },
  ) {
    return this.prisma.crawlCheckpoint.upsert({
      where: { crawlerName },
      create: {
        crawlerName,
        lastCursor: body.lastCursor ?? null,
        lastUrl: body.lastUrl ?? null,
        lastTopic: body.lastTopic ?? null,
        lastProcessed: body.lastProcessed ?? null,
        meta: body.meta ?? undefined,
      },
      update: {
        lastCursor: body.lastCursor,
        lastUrl: body.lastUrl,
        lastTopic: body.lastTopic,
        lastProcessed: body.lastProcessed ?? undefined,
        meta: body.meta ?? undefined,
      },
    });
  }

  async createSource(data: {
    name: string;
    baseUrl: string;
    kind: string;
    trustTier?: number;
    topicId?: bigint;
  }) {
    return this.prisma.source.create({
      data: {
        name: data.name,
        baseUrl: data.baseUrl,
        kind: data.kind,
        trustTier: data.trustTier ?? 3,
        topicId: data.topicId,
      },
    });
  }

  async getCrawlTask(id: bigint) {
    const task = await this.prisma.crawlTask.findUnique({
      where: { id },
      include: { source: true },
    });
    if (!task) throw new NotFoundException('CrawlTask not found');
    return task;
  }

  /**
   * 登记 URL（幂等：urlFingerprint 唯一）
   */
  async registerCrawledUrl(
    sourceId: bigint,
    url: string,
    contentHash?: string | null,
  ) {
    await this.ensureSource(sourceId);
    const fp = urlFingerprint(url);
    const existing = await this.prisma.crawledUrl.findUnique({
      where: { urlFingerprint: fp },
    });
    if (existing) {
      return { duplicate: true, row: existing } as const;
    }
    const row = await this.prisma.crawledUrl.create({
      data: {
        sourceId,
        url,
        urlFingerprint: fp,
        contentHash: contentHash ?? null,
        status: 'registered',
        fetchedAt: null,
      },
    });
    return { duplicate: false, row } as const;
  }

  /**
   * 创建爬取任务；async 时入队 BullMQ，否则同步执行桩逻辑。
   */
  async createCrawlTask(args: {
    sourceId: bigint;
    async: boolean;
    crawlerName?: string;
    cursor?: string;
    seedUrls?: string[];
  }) {
    await this.ensureSource(args.sourceId);
    const crawlerName =
      args.crawlerName ?? `source:${args.sourceId.toString()}`;

    const task = await this.prisma.crawlTask.create({
      data: {
        sourceId: args.sourceId,
        status: 'queued',
        cursor: args.cursor ?? null,
      },
    });

    const payload: CrawlJobPayload = {
      crawlTaskId: task.id.toString(),
      sourceId: args.sourceId.toString(),
      crawlerName,
      cursor: args.cursor,
      seedUrls: args.seedUrls,
    };

    if (args.async) {
      const jobId = buildCrawlJobId(payload);
      try {
        await this.crawlQueue.add(CRAWL_JOB_NAME, payload, {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: 500,
          removeOnFail: 1000,
        });
      } catch {
        const job = await this.crawlQueue.getJob(jobId);
        if (!job) throw new Error('Failed to enqueue crawl job');
      }
    } else {
      await this.processCrawlJob(payload);
    }

    return this.getCrawlTask(task.id);
  }

  /** Worker / 同步调用：桩抓取（写入 CrawledUrl + 更新 checkpoint） */
  async processCrawlJob(payload: CrawlJobPayload): Promise<void> {
    const taskId = BigInt(payload.crawlTaskId);
    const sourceId = BigInt(payload.sourceId);

    await this.prisma.crawlTask.update({
      where: { id: taskId },
      data: { status: 'running' },
    });

    try {
      const urls = payload.seedUrls ?? [];
      const now = new Date();
      for (const u of urls) {
        const fp = urlFingerprint(u);
        await this.prisma.crawledUrl.upsert({
          where: { urlFingerprint: fp },
          create: {
            sourceId,
            url: u,
            urlFingerprint: fp,
            status: 'fetched_stub',
            fetchedAt: now,
          },
          update: {
            status: 'fetched_stub',
            fetchedAt: now,
          },
        });
      }

      await this.prisma.crawlCheckpoint.upsert({
        where: { crawlerName: payload.crawlerName },
        create: {
          crawlerName: payload.crawlerName,
          lastCursor: payload.cursor ?? null,
          lastUrl: urls[urls.length - 1] ?? null,
          lastProcessed: now,
          meta: {
            kind: 'stub',
            urlCount: urls.length,
            crawlTaskId: payload.crawlTaskId,
          } as Prisma.InputJsonValue,
        },
        update: {
          lastCursor: payload.cursor ?? undefined,
          lastUrl: urls[urls.length - 1] ?? undefined,
          lastProcessed: now,
          meta: {
            kind: 'stub',
            urlCount: urls.length,
            crawlTaskId: payload.crawlTaskId,
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.crawlTask.update({
        where: { id: taskId },
        data: { status: 'completed', cursor: payload.cursor ?? undefined },
      });
    } catch (e) {
      await this.prisma.crawlTask.update({
        where: { id: taskId },
        data: { status: 'failed' },
      });
      throw e;
    }
  }

  private async ensureSource(id: bigint) {
    const s = await this.prisma.source.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Source not found');
  }
}
