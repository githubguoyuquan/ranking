import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ElasticService } from '../search/elastic.service';
import { EmbeddingService } from '../search/embedding.service';
import { DEFAULT_EMBEDDING_MODEL } from '../search/embedding.constants';
import { elasticCrawledUrlSyncOutboxCreate } from '../search/elastic-crawled-url-outbox';
import {
  buildCrawlJobId,
  CRAWL_JOB_NAME,
  CRAWL_QUEUE,
  type CrawlJobPayload,
  urlFingerprint,
} from './crawl-job';
import { clampCrawlTasksListTake } from './crawl-list-limits';
import { CrawlHostThrottleService } from './crawl-host-throttle.service';
import {
  crawlSemanticDedupCandidateLimit,
  crawlSemanticDedupEnabled,
  crawlSemanticDedupMinChars,
  crawlSemanticDedupText,
  crawlSemanticDedupThreshold,
  findNearestByCosine,
} from './crawl-semantic-dedup';
import { crawlUrlViolation, fetchUrlForCrawl, normalizeCrawlProxyUrl } from './http-fetch';
import { fetchUrlForCrawlPlaywright } from './http-fetch-playwright';

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly elastic: ElasticService,
    private readonly embedding: EmbeddingService,
    private readonly hostThrottle: CrawlHostThrottleService,
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
    httpProxyUrl?: string | null;
  }) {
    return this.prisma.source.create({
      data: {
        name: data.name,
        baseUrl: data.baseUrl,
        kind: data.kind,
        trustTier: data.trustTier ?? 3,
        topicId: data.topicId,
        httpProxyUrl: data.httpProxyUrl?.trim() || null,
      },
    });
  }

  async listSources(limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    return this.prisma.source.findMany({
      orderBy: { id: 'desc' },
      take,
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

  /** 最近任务（运营台列表 / 引擎监控）；可选按 sourceId 收窄 */
  async listCrawlTasks(limit = 30, sourceId?: bigint) {
    const take = clampCrawlTasksListTake(limit);
    return this.prisma.crawlTask.findMany({
      where: sourceId !== undefined ? { sourceId } : undefined,
      orderBy: { id: 'desc' },
      take,
      include: {
        source: { select: { id: true, name: true, kind: true } },
      },
    });
  }

  async listCrawledUrlsForSource(sourceId: bigint, limit = 50) {
    await this.ensureSource(sourceId);
    const take = Math.min(Math.max(limit, 1), 100);
    return this.prisma.crawledUrl.findMany({
      where: { sourceId },
      orderBy: { id: 'desc' },
      take,
    });
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
        mimeType: null,
        textPreview: null,
        pageTitle: null,
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

  /** Worker / 同步：默认桩写入；`CRAWL_HTTP_FETCH=true` 或 Source.kind=http-fetch 时真 GET + SHA256（见 `http-fetch.ts`） */
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
      const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
      if (!source) {
        throw new NotFoundException('Source not found');
      }
      const proxyUrl =
        normalizeCrawlProxyUrl(source.httpProxyUrl) ??
        normalizeCrawlProxyUrl(process.env.CRAWL_HTTP_PROXY);

      const useHttp = await this.useHttpFetch(sourceId);
      const usePw = useHttp && (await this.usePlaywrightFetch(sourceId));
      let fetchErrors = 0;

      for (const u of urls) {
        const fp = urlFingerprint(u);
        if (!useHttp) {
          await this.prisma.$transaction(async (tx) => {
            const row = await tx.crawledUrl.upsert({
              where: { urlFingerprint: fp },
              create: {
                sourceId,
                url: u,
                urlFingerprint: fp,
                status: 'fetched_stub',
                fetchedAt: now,
                mimeType: null,
                textPreview: null,
                pageTitle: null,
              },
              update: {
                status: 'fetched_stub',
                fetchedAt: now,
                mimeType: null,
                textPreview: null,
                pageTitle: null,
                duplicateOfId: null,
                previewEmbedding: Prisma.JsonNull,
                previewEmbeddingModel: null,
              },
            });
            await this.enqueueCrawledUrlEsOutbox(tx, row);
          });
          continue;
        }

        const viol = crawlUrlViolation(u);
        if (viol) {
          fetchErrors += 1;
          await this.prisma.$transaction(async (tx) => {
            const row = await tx.crawledUrl.upsert({
              where: { urlFingerprint: fp },
              create: {
                sourceId,
                url: u,
                urlFingerprint: fp,
                status: 'fetch_blocked',
                contentHash: null,
                fetchedAt: now,
                mimeType: null,
                textPreview: null,
                pageTitle: null,
              },
              update: {
                status: 'fetch_blocked',
                contentHash: null,
                fetchedAt: now,
                mimeType: null,
                textPreview: null,
                pageTitle: null,
                duplicateOfId: null,
                previewEmbedding: Prisma.JsonNull,
                previewEmbeddingModel: null,
              },
            });
            await this.enqueueCrawledUrlEsOutbox(tx, row);
          });
          continue;
        }

        let host: string;
        try {
          host = new URL(u).hostname.toLowerCase();
        } catch {
          fetchErrors += 1;
          await this.prisma.$transaction(async (tx) => {
            const row = await tx.crawledUrl.upsert({
              where: { urlFingerprint: fp },
              create: {
                sourceId,
                url: u,
                urlFingerprint: fp,
                status: 'fetch_failed',
                contentHash: null,
                fetchedAt: now,
                mimeType: null,
                textPreview: null,
                pageTitle: null,
              },
              update: {
                status: 'fetch_failed',
                contentHash: null,
                fetchedAt: now,
                mimeType: null,
                textPreview: null,
                pageTitle: null,
                duplicateOfId: null,
                previewEmbedding: Prisma.JsonNull,
                previewEmbeddingModel: null,
              },
            });
            await this.enqueueCrawledUrlEsOutbox(tx, row);
          });
          continue;
        }
        await this.hostThrottle.waitForHost(host);

        const fetchOpts = { proxyUrl };
        const fetched = usePw
          ? await fetchUrlForCrawlPlaywright(u, fetchOpts)
          : await fetchUrlForCrawl(u, fetchOpts);
        if (fetched.ok) {
          const sem = await this.resolveSemanticMeta(
            sourceId,
            fp,
            fetched.pageTitle,
            fetched.textPreview,
          );
          const isSemanticDup = Boolean(sem.canonicalId);
          const status = isSemanticDup ? 'fetched_semantic_dup' : 'fetched';

          await this.prisma.$transaction(async (tx) => {
            const row = await tx.crawledUrl.upsert({
              where: { urlFingerprint: fp },
              create: {
                sourceId,
                url: u,
                urlFingerprint: fp,
                status,
                contentHash: fetched.contentHash,
                mimeType: fetched.mimeType,
                textPreview: fetched.textPreview,
                pageTitle: fetched.pageTitle,
                fetchedAt: now,
                duplicateOfId: sem.canonicalId,
                previewEmbedding:
                  !isSemanticDup && sem.vec ? sem.vec : Prisma.JsonNull,
                previewEmbeddingModel:
                  !isSemanticDup && sem.vec ? DEFAULT_EMBEDDING_MODEL : null,
              },
              update: {
                status,
                contentHash: fetched.contentHash,
                mimeType: fetched.mimeType,
                textPreview: fetched.textPreview,
                pageTitle: fetched.pageTitle,
                fetchedAt: now,
                duplicateOfId: sem.canonicalId,
                previewEmbedding:
                  !isSemanticDup && sem.vec ? sem.vec : Prisma.JsonNull,
                previewEmbeddingModel:
                  !isSemanticDup && sem.vec ? DEFAULT_EMBEDDING_MODEL : null,
              },
            });
            await this.enqueueCrawledUrlEsOutbox(tx, row);
          });
        } else {
          fetchErrors += 1;
          await this.prisma.$transaction(async (tx) => {
            const row = await tx.crawledUrl.upsert({
              where: { urlFingerprint: fp },
              create: {
                sourceId,
                url: u,
                urlFingerprint: fp,
                status: 'fetch_failed',
                contentHash: null,
                fetchedAt: now,
                mimeType: null,
                textPreview: null,
                pageTitle: null,
              },
              update: {
                status: 'fetch_failed',
                contentHash: null,
                fetchedAt: now,
                mimeType: null,
                textPreview: null,
                pageTitle: null,
                duplicateOfId: null,
                previewEmbedding: Prisma.JsonNull,
                previewEmbeddingModel: null,
              },
            });
            await this.enqueueCrawledUrlEsOutbox(tx, row);
          });
        }
      }

      const metaKind = !useHttp ? 'stub' : usePw ? 'http-playwright' : 'http-fetch';
      await this.prisma.crawlCheckpoint.upsert({
        where: { crawlerName: payload.crawlerName },
        create: {
          crawlerName: payload.crawlerName,
          lastCursor: payload.cursor ?? null,
          lastUrl: urls[urls.length - 1] ?? null,
          lastProcessed: now,
          meta: {
            kind: metaKind,
            urlCount: urls.length,
            fetchErrors: useHttp ? fetchErrors : undefined,
            crawlTaskId: payload.crawlTaskId,
          } as Prisma.InputJsonValue,
        },
        update: {
          lastCursor: payload.cursor ?? undefined,
          lastUrl: urls[urls.length - 1] ?? undefined,
          lastProcessed: now,
          meta: {
            kind: metaKind,
            urlCount: urls.length,
            fetchErrors: useHttp ? fetchErrors : undefined,
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

  /**
   * OpenAI 向量与同信源近期 canonical 行比对；命中则返回 canonical `CrawledUrl.id`，否则返回本页向量供写入。
   */
  private async resolveSemanticMeta(
    sourceId: bigint,
    excludeUrlFingerprint: string,
    pageTitle: string | null,
    textPreview: string | null,
  ): Promise<{ vec: number[] | null; canonicalId: bigint | null }> {
    if (!crawlSemanticDedupEnabled() || !this.embedding.isConfigured()) {
      return { vec: null, canonicalId: null };
    }
    const text = crawlSemanticDedupText(pageTitle, textPreview);
    if (!text || text.length < crawlSemanticDedupMinChars()) {
      return { vec: null, canonicalId: null };
    }
    let vec: number[];
    try {
      vec = await this.embedding.embedText(text);
    } catch {
      return { vec: null, canonicalId: null };
    }
    const rows = await this.prisma.crawledUrl.findMany({
      where: {
        sourceId,
        status: 'fetched',
        duplicateOfId: null,
        urlFingerprint: { not: excludeUrlFingerprint },
        previewEmbedding: { not: Prisma.DbNull },
      },
      orderBy: { id: 'desc' },
      take: crawlSemanticDedupCandidateLimit(),
      select: { id: true, previewEmbedding: true },
    });
    const canonicalId = findNearestByCosine(vec, rows, crawlSemanticDedupThreshold());
    return { vec, canonicalId };
  }

  /** 全局开关或 Source.kind === http-fetch / http-playwright 时使用真抓取（GET 或 Playwright） */
  private async useHttpFetch(sourceId: bigint): Promise<boolean> {
    if (process.env.CRAWL_HTTP_FETCH === 'true') return true;
    if (process.env.CRAWL_USE_PLAYWRIGHT === 'true') return true;
    const s = await this.prisma.source.findUnique({ where: { id: sourceId } });
    return s?.kind === 'http-fetch' || s?.kind === 'http-playwright';
  }

  /** 全局 `CRAWL_USE_PLAYWRIGHT=true` 或 `Source.kind=http-playwright` 时用 Chromium 渲染抓取 */
  private async usePlaywrightFetch(sourceId: bigint): Promise<boolean> {
    if (process.env.CRAWL_USE_PLAYWRIGHT === 'true') return true;
    const s = await this.prisma.source.findUnique({ where: { id: sourceId } });
    return s?.kind === 'http-playwright';
  }

  private async enqueueCrawledUrlEsOutbox(
    tx: Prisma.TransactionClient,
    row: { id: bigint; status: string },
  ): Promise<void> {
    if (!this.elastic.isEnabled()) return;
    const action = row.status === 'fetched' ? 'upsert' : 'delete';
    await tx.outboxEvent.create({ data: elasticCrawledUrlSyncOutboxCreate(row.id, action) });
  }
}
