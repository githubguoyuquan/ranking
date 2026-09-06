import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { AI_AUDIT_SOURCE_EMBEDDING_INGESTION } from '../ai-audit/ai-audit.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ElasticService } from '../search/elastic.service';
import { EmbeddingService } from '../search/embedding.service';
import { DEFAULT_EMBEDDING_MODEL } from '../search/embedding.constants';
import { elasticCrawledUrlSyncOutboxCreate } from '../search/elastic-crawled-url-outbox';
import { OUTBOX_TYPE_CRAWL_URL_FETCHED } from '../outbox/outbox.constants';
import {
  buildCrawlJobId,
  CRAWL_JOB_NAME,
  CRAWL_QUEUE,
  type CrawlJobPayload,
  urlFingerprint,
} from './crawl-job';
import { buildCrawlUrlFetchedOutboxPayload } from './crawl-url-fetched-outbox-payload';
import { clampCrawlTasksListTake } from './crawl-list-limits';
import { AgentOrchestrationService } from '../agent-orchestration/agent-orchestration.service';
import { CrawlHostThrottleService } from './crawl-host-throttle.service';
import {
  crawlSemanticDedupCandidateLimit,
  crawlSemanticDedupCrossSourceCandidateLimit,
  crawlSemanticDedupCrossSourceEnabled,
  crawlSemanticDedupEnabled,
  crawlSemanticDedupMinChars,
  crawlSemanticDedupText,
  crawlSemanticDedupThreshold,
  findNearestByCosine,
} from './crawl-semantic-dedup';
import { pickCrawlProxyFromPool } from './crawl-proxy-pool';
import { CrawlRegionalQueueService } from './crawl-regional-queue.service';
import { fetchCrawlWithRetry, pickCrawlUserAgent } from './crawl-fetch-retry';
import {
  crawlFollowLinksEnabled,
  crawlFollowLinksMaxDepth,
  crawlFollowLinksMaxPerTask,
  crawlLinkExtractMaxPerPage,
  isLinkHostAllowed,
  resolveLinkAllowHosts,
} from './crawl-link-extract';
import {
  crawlRespectRobotsEnabled,
  isCrawlUrlAllowedByRobots,
  type RobotsCache,
} from './crawl-robots';
import { crawlUrlViolation, fetchUrlForCrawl, normalizeCrawlProxyUrl } from './http-fetch';
import { fetchUrlForCrawlPlaywright } from './http-fetch-playwright';
import { CrawlSignalExtractService } from './crawl-signal-extract.service';

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly elastic: ElasticService,
    private readonly embedding: EmbeddingService,
    private readonly hostThrottle: CrawlHostThrottleService,
    @InjectQueue(CRAWL_QUEUE) private readonly crawlQueue: Queue<CrawlJobPayload>,
    private readonly regionalQueue: CrawlRegionalQueueService,
    private readonly agentOrchestration: AgentOrchestrationService,
    private readonly crawlSignalExtract: CrawlSignalExtractService,
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
    scheduleEnabled?: boolean;
    scheduleIntervalMinutes?: number | null;
    scheduleCron?: string | null;
    scheduleTimezone?: string;
    region?: string | null;
    schedulePriority?: number;
  }) {
    return this.prisma.source.create({
      data: {
        name: data.name,
        baseUrl: data.baseUrl,
        kind: data.kind,
        trustTier: data.trustTier ?? 3,
        topicId: data.topicId,
        httpProxyUrl: data.httpProxyUrl?.trim() || null,
        scheduleEnabled: data.scheduleEnabled ?? false,
        scheduleIntervalMinutes: data.scheduleIntervalMinutes ?? null,
        scheduleCron: data.scheduleCron?.trim() || null,
        scheduleTimezone: data.scheduleTimezone?.trim() || 'UTC',
        region: data.region?.trim() || null,
        schedulePriority: data.schedulePriority ?? 0,
      },
    });
  }

  async patchSource(
    id: bigint,
    data: {
      name?: string;
      baseUrl?: string;
      kind?: string;
      trustTier?: number;
      httpProxyUrl?: string | null;
      scheduleEnabled?: boolean;
      scheduleIntervalMinutes?: number | null;
      scheduleCron?: string | null;
      scheduleTimezone?: string;
      region?: string | null;
      schedulePriority?: number;
    },
  ) {
    await this.ensureSource(id);
    return this.prisma.source.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.baseUrl !== undefined ? { baseUrl: data.baseUrl } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.trustTier !== undefined ? { trustTier: data.trustTier } : {}),
        ...(data.httpProxyUrl !== undefined
          ? { httpProxyUrl: data.httpProxyUrl?.trim() || null }
          : {}),
        ...(data.scheduleEnabled !== undefined
          ? { scheduleEnabled: data.scheduleEnabled }
          : {}),
        ...(data.scheduleIntervalMinutes !== undefined
          ? { scheduleIntervalMinutes: data.scheduleIntervalMinutes }
          : {}),
        ...(data.scheduleCron !== undefined
          ? { scheduleCron: data.scheduleCron?.trim() || null }
          : {}),
        ...(data.scheduleTimezone !== undefined
          ? { scheduleTimezone: data.scheduleTimezone.trim() || 'UTC' }
          : {}),
        ...(data.region !== undefined ? { region: data.region?.trim() || null } : {}),
        ...(data.schedulePriority !== undefined
          ? { schedulePriority: data.schedulePriority }
          : {}),
      },
    });
  }

  async listSources(limit = 50, tenantId?: bigint) {
    const take = Math.min(Math.max(limit, 1), 100);
    return this.prisma.source.findMany({
      where: tenantId !== undefined ? { tenantId } : {},
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
    /** 覆盖队列区域（默认读信源 `region`） */
    queueRegion?: string | null;
  }) {
    const source = await this.ensureSource(args.sourceId);
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

    const queueRegion = args.queueRegion ?? source.region;

    if (args.async) {
      const jobId = buildCrawlJobId(payload);
      const queue =
        this.regionalQueue.resolveQueueName(queueRegion) ===
        this.regionalQueue.resolveQueueName(null)
          ? this.crawlQueue
          : null;
      try {
        if (queue) {
          await queue.add(CRAWL_JOB_NAME, payload, {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: 500,
            removeOnFail: 1000,
          });
        } else {
          await this.regionalQueue.addJob(queueRegion, payload, { jobId });
        }
      } catch {
        const q = queue ?? this.regionalQueue.getQueue(queueRegion);
        const job = await q.getJob(jobId);
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
      const seedUrls = payload.seedUrls ?? [];
      const now = new Date();
      const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
      if (!source) {
        throw new NotFoundException('Source not found');
      }
      const proxyUrl =
        normalizeCrawlProxyUrl(source.httpProxyUrl) ??
        pickCrawlProxyFromPool() ??
        normalizeCrawlProxyUrl(process.env.CRAWL_HTTP_PROXY);

      const useHttp = await this.useHttpFetch(sourceId);
      const usePw = useHttp && (await this.usePlaywrightFetch(sourceId));
      let fetchErrors = 0;

      const followLinks = useHttp && crawlFollowLinksEnabled();
      const maxUrls = followLinks
        ? crawlFollowLinksMaxPerTask()
        : Math.max(seedUrls.length, 1);
      const maxDepth = crawlFollowLinksMaxDepth();
      const linkAllowHosts = resolveLinkAllowHosts(
        source.baseUrl,
        seedUrls[0] ?? source.baseUrl,
      );
      const respectRobots = followLinks && crawlRespectRobotsEnabled();
      const robotsCache: RobotsCache = new Map();
      type QueueItem = { url: string; depth: number };
      const queue: QueueItem[] = seedUrls.map((url) => ({ url, depth: 0 }));
      const visited = new Set<string>();
      let processed = 0;
      let lastUrl: string | null = null;
      let linksEnqueued = 0;
      let robotsBlocked = 0;
      let depthSkipped = 0;

      while (queue.length > 0 && processed < maxUrls) {
        const item = queue.shift()!;
        const u = item.url;
        const fp = urlFingerprint(u);
        if (visited.has(fp)) continue;
        visited.add(fp);

        if (followLinks && item.depth > maxDepth) {
          depthSkipped += 1;
          continue;
        }

        if (!isLinkHostAllowed(u, linkAllowHosts)) {
          fetchErrors += 1;
          await this.persistFetchFailure(sourceId, u, fp, now, 'fetch_blocked');
          continue;
        }

        if (respectRobots) {
          const ua = pickCrawlUserAgent(u);
          const robotsOk = await isCrawlUrlAllowedByRobots(u, robotsCache, ua);
          if (!robotsOk) {
            robotsBlocked += 1;
            await this.persistFetchFailure(sourceId, u, fp, now, 'robots_disallowed');
            continue;
          }
        }

        processed += 1;
        lastUrl = u;

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
                domFeaturesJson: Prisma.JsonNull,
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
                domFeaturesJson: Prisma.JsonNull,
              },
            });
            await this.enqueueCrawledUrlEsOutbox(tx, row);
          });
          continue;
        }

        const viol = crawlUrlViolation(u);
        if (viol) {
          fetchErrors += 1;
          await this.persistFetchFailure(sourceId, u, fp, now, 'fetch_blocked');
          continue;
        }

        let host: string;
        try {
          host = new URL(u).hostname.toLowerCase();
        } catch {
          fetchErrors += 1;
          await this.persistFetchFailure(sourceId, u, fp, now, 'fetch_failed');
          continue;
        }
        await this.hostThrottle.waitForHost(host);

        const fetchOpts = {
          proxyUrl,
          userAgent: pickCrawlUserAgent(u),
          ...(followLinks
            ? {
                linkAllowHosts: [...linkAllowHosts],
                linkExtractMax: crawlLinkExtractMaxPerPage(),
              }
            : {}),
        };
        const fetched = await fetchCrawlWithRetry(() =>
          usePw
            ? fetchUrlForCrawlPlaywright(u, fetchOpts)
            : fetchUrlForCrawl(u, fetchOpts),
        );
        if (fetched.ok) {
          const sem = await this.resolveSemanticMeta(
            sourceId,
            fp,
            fetched.pageTitle,
            fetched.textPreview,
          );
          const isSemanticDup = Boolean(sem.canonicalId);
          const status = isSemanticDup ? 'fetched_semantic_dup' : 'fetched';
          const domJson =
            fetched.domFeatures != null
              ? (fetched.domFeatures as Prisma.InputJsonValue)
              : Prisma.JsonNull;

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
                domFeaturesJson: domJson,
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
                domFeaturesJson: domJson,
                fetchedAt: now,
                duplicateOfId: sem.canonicalId,
                previewEmbedding:
                  !isSemanticDup && sem.vec ? sem.vec : Prisma.JsonNull,
                previewEmbeddingModel:
                  !isSemanticDup && sem.vec ? DEFAULT_EMBEDDING_MODEL : null,
              },
            });
            await this.enqueueCrawledUrlEsOutbox(tx, row);
            if (process.env.KAFKA_MESH_CRAWL_EVENTS !== 'false') {
              await tx.outboxEvent.create({
                data: {
                  type: OUTBOX_TYPE_CRAWL_URL_FETCHED,
                  payload: buildCrawlUrlFetchedOutboxPayload({
                    crawledUrlId: row.id,
                    sourceId,
                    url: u,
                    status,
                    contentHash: fetched.contentHash,
                    pageTitle: fetched.pageTitle,
                    duplicateOfId: sem.canonicalId,
                    fetchedAt: now,
                  }),
                },
              });
            }
          });

          if (!isSemanticDup) {
            void this.crawlSignalExtract
              .maybeIngestFromCrawledPage({
                sourceId,
                pageTitle: fetched.pageTitle,
                textPreview: fetched.textPreview,
                domFeaturesJson:
                  domJson === Prisma.JsonNull ? null : (domJson as Prisma.InputJsonValue),
                observedAt: now,
              })
              .catch(() => undefined);
          }

          if (followLinks && fetched.discoveredLinks?.length && item.depth < maxDepth) {
            for (const link of fetched.discoveredLinks) {
              if (visited.size + queue.length >= maxUrls) break;
              if (!isLinkHostAllowed(link, linkAllowHosts)) continue;
              const lfp = urlFingerprint(link);
              if (visited.has(lfp) || queue.some((q) => urlFingerprint(q.url) === lfp)) {
                continue;
              }
              if (respectRobots) {
                const linkOk = await isCrawlUrlAllowedByRobots(
                  link,
                  robotsCache,
                  pickCrawlUserAgent(link),
                );
                if (!linkOk) continue;
              }
              queue.push({ url: link, depth: item.depth + 1 });
              linksEnqueued += 1;
            }
          }
        } else {
          fetchErrors += 1;
          await this.persistFetchFailure(sourceId, u, fp, now, 'fetch_failed');
        }
      }

      const metaKind = !useHttp ? 'stub' : usePw ? 'http-playwright' : 'http-fetch';
      await this.prisma.crawlCheckpoint.upsert({
        where: { crawlerName: payload.crawlerName },
        create: {
          crawlerName: payload.crawlerName,
          lastCursor: payload.cursor ?? null,
          lastUrl,
          lastProcessed: now,
          meta: {
            kind: metaKind,
            seedCount: seedUrls.length,
            urlCount: processed,
            linksEnqueued: followLinks ? linksEnqueued : undefined,
            followLinks,
            maxDepth: followLinks ? maxDepth : undefined,
            linkAllowHosts: followLinks ? [...linkAllowHosts] : undefined,
            robotsBlocked: followLinks && respectRobots ? robotsBlocked : undefined,
            depthSkipped: followLinks ? depthSkipped : undefined,
            fetchErrors: useHttp ? fetchErrors : undefined,
            crawlTaskId: payload.crawlTaskId,
          } as Prisma.InputJsonValue,
        },
        update: {
          lastCursor: payload.cursor ?? undefined,
          lastUrl: lastUrl ?? undefined,
          lastProcessed: now,
          meta: {
            kind: metaKind,
            seedCount: seedUrls.length,
            urlCount: processed,
            linksEnqueued: followLinks ? linksEnqueued : undefined,
            followLinks,
            maxDepth: followLinks ? maxDepth : undefined,
            linkAllowHosts: followLinks ? [...linkAllowHosts] : undefined,
            robotsBlocked: followLinks && respectRobots ? robotsBlocked : undefined,
            depthSkipped: followLinks ? depthSkipped : undefined,
            fetchErrors: useHttp ? fetchErrors : undefined,
            crawlTaskId: payload.crawlTaskId,
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.crawlTask.update({
        where: { id: taskId },
        data: { status: 'completed', cursor: payload.cursor ?? undefined },
      });

      void this.agentOrchestration
        .maybeEnqueueDiscoveryAfterCrawl(sourceId)
        .catch(() => undefined);
    } catch (e) {
      await this.prisma.crawlTask.update({
        where: { id: taskId },
        data: { status: 'failed' },
      });
      throw e;
    }
  }

  private async persistFetchFailure(
    sourceId: bigint,
    url: string,
    fp: string,
    now: Date,
    status: 'fetch_failed' | 'fetch_blocked' | 'robots_disallowed',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.crawledUrl.upsert({
        where: { urlFingerprint: fp },
        create: {
          sourceId,
          url,
          urlFingerprint: fp,
          status,
          contentHash: null,
          fetchedAt: now,
          mimeType: null,
          textPreview: null,
          pageTitle: null,
          domFeaturesJson: Prisma.JsonNull,
        },
        update: {
          status,
          contentHash: null,
          fetchedAt: now,
          mimeType: null,
          textPreview: null,
          pageTitle: null,
          duplicateOfId: null,
          previewEmbedding: Prisma.JsonNull,
          previewEmbeddingModel: null,
          domFeaturesJson: Prisma.JsonNull,
        },
      });
      await this.enqueueCrawledUrlEsOutbox(tx, row);
    });
  }

  private async ensureSource(id: bigint) {
    const s = await this.prisma.source.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Source not found');
    return s;
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
      vec = await this.embedding.embedText(text, {
        source: AI_AUDIT_SOURCE_EMBEDDING_INGESTION,
        operation: 'crawl_semantic_dedup',
      });
    } catch {
      return { vec: null, canonicalId: null };
    }
    const sameSourceRows = await this.prisma.crawledUrl.findMany({
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
    let canonicalId = findNearestByCosine(vec, sameSourceRows, crawlSemanticDedupThreshold());

    if (canonicalId === null && crawlSemanticDedupCrossSourceEnabled()) {
      const crossRows = await this.prisma.crawledUrl.findMany({
        where: {
          status: 'fetched',
          duplicateOfId: null,
          urlFingerprint: { not: excludeUrlFingerprint },
          previewEmbedding: { not: Prisma.DbNull },
          sourceId: { not: sourceId },
        },
        orderBy: { id: 'desc' },
        take: crawlSemanticDedupCrossSourceCandidateLimit(),
        select: { id: true, previewEmbedding: true },
      });
      canonicalId = findNearestByCosine(vec, crossRows, crawlSemanticDedupThreshold());
    }
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
