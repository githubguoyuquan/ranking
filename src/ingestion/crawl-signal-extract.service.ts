import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CrawlDomFeatures } from './crawl-dom-extract';
import {
  crawlSignalExtractEnabled,
  extractSignalsFromCrawlText,
} from './crawl-signal-extract';

@Injectable()
export class CrawlSignalExtractService {
  private readonly logger = new Logger(CrawlSignalExtractService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 抓取成功后：匹配实体 → 抽取信号 → 写入 EntityMetric。
   * 失败静默，不阻断主抓取流程。
   */
  async maybeIngestFromCrawledPage(args: {
    sourceId: bigint;
    pageTitle: string | null;
    textPreview: string | null;
    domFeaturesJson: Prisma.InputJsonValue | null;
    observedAt: Date;
    sourceTier?: number;
  }): Promise<{ entityId: string | null; ingested: number }> {
    if (!crawlSignalExtractEnabled()) {
      return { entityId: null, ingested: 0 };
    }

    const dom = parseDomFeatures(args.domFeaturesJson);
    const titleCandidates = [
      args.pageTitle,
      dom?.ogTitle,
      dom?.h1?.[0],
    ]
      .map((s) => s?.trim())
      .filter(Boolean) as string[];

    const textBlob = [
      args.pageTitle,
      dom?.metaDescription,
      dom?.ogDescription,
      dom?.h1?.join(' '),
      args.textPreview,
    ]
      .filter(Boolean)
      .join('\n');

    const signals = extractSignalsFromCrawlText(textBlob);
    if (signals.length === 0) {
      return { entityId: null, ingested: 0 };
    }

    const entityId = await this.resolveEntityForSource(args.sourceId, titleCandidates);
    if (!entityId) {
      this.logger.debug(`crawl signal: no entity match for source ${args.sourceId}`);
      return { entityId: null, ingested: 0 };
    }

    const tier = args.sourceTier ?? 3;
    await this.prisma.entityMetric.createMany({
      data: signals.map((s) => ({
        entityId,
        metricKey: s.metricKey,
        value: s.value,
        unit: s.unit ?? null,
        sourceTier: tier,
        observedAt: args.observedAt,
      })),
      skipDuplicates: false,
    });

    this.logger.log(
      `crawl signal ingest entity=${entityId.toString()} keys=${signals.map((s) => s.metricKey).join(',')}`,
    );
    return { entityId: entityId.toString(), ingested: signals.length };
  }

  private async resolveEntityForSource(
    sourceId: bigint,
    titleCandidates: string[],
  ): Promise<bigint | null> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { topicId: true, trustTier: true },
    });
    if (!source?.topicId) return null;

    const entities = await this.prisma.entity.findMany({
      where: {
        rankingItems: {
          some: {
            snapshot: {
              topicRanking: { topicVersion: { topicId: source.topicId } },
            },
          },
        },
      },
      select: { id: true, canonicalName: true },
      take: 500,
    });
    if (entities.length === 0) return null;

    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const title of titleCandidates) {
      const nt = norm(title);
      for (const e of entities) {
        const nc = norm(e.canonicalName);
        if (nt.includes(nc) || nc.includes(nt)) return e.id;
      }
    }
    return null;
  }
}

function parseDomFeatures(json: Prisma.InputJsonValue | null): CrawlDomFeatures | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  return json as CrawlDomFeatures;
}
