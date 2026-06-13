import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, TimeWindow } from '@prisma/client';
import {
  dedupeTrendAnomalies,
  detectAnomaliesFromSnapshotSummary,
  type SnapshotTrendPayload,
  type TrendAnomalyItem,
  worstTrendAlertStatus,
} from '../domain/trend-anomaly';
import { toPlainJson } from '../lib/json';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReadService } from '../scale/prisma-read.service';
import { trendAnomalyThresholds } from './trend-anomaly.config';

export type TrendAnomalyScanResult = {
  scannedAnalyses: number;
  scannedStreakEntities: number;
  thresholds: ReturnType<typeof trendAnomalyThresholds>;
  status: 'ok' | 'warn' | 'critical';
  anomalies: TrendAnomalyItem[];
  generatedAt: string;
};

@Injectable()
export class TrendAnomalyService {
  private readonly logger = new Logger(TrendAnomalyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly readPrisma: PrismaReadService,
  ) {}

  getThresholds() {
    return trendAnomalyThresholds();
  }

  async scanRecentAnomalies(opts: {
    hours?: number;
    timeWindow?: TimeWindow;
    analysisLimit?: number;
    streakEntityLimit?: number;
    includeStreaks?: boolean;
  } = {}): Promise<TrendAnomalyScanResult> {
    const thresholds = trendAnomalyThresholds();
    const hours = Math.min(Math.max(opts.hours ?? 48, 1), 168);
    const since = new Date(Date.now() - hours * 3_600_000);
    const analysisTake = Math.min(Math.max(opts.analysisLimit ?? 80, 1), 200);
    const streakTake = Math.min(Math.max(opts.streakEntityLimit ?? 30, 0), 100);
    const includeStreaks = opts.includeStreaks !== false;

    const rows = await this.readPrisma.trendAnalysis.findMany({
      where: {
        entityId: null,
        createdAt: { gte: since },
        ...(opts.timeWindow ? { window: opts.timeWindow } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: analysisTake,
      select: {
        topicId: true,
        createdAt: true,
        payload: true,
      },
    });

    const topicIds = [...new Set(rows.map((r) => r.topicId))];
    const topics =
      topicIds.length === 0
        ? []
        : await this.readPrisma.topic.findMany({
            where: { id: { in: topicIds } },
            select: { id: true, slug: true },
          });
    const slugByTopicId = new Map(topics.map((t) => [t.id.toString(), t.slug]));

    const anomalies: TrendAnomalyItem[] = [];
    for (const r of rows) {
      const payload = (r.payload ?? {}) as SnapshotTrendPayload;
      const topicId = r.topicId.toString();
      anomalies.push(
        ...detectAnomaliesFromSnapshotSummary(payload, thresholds, {
          topicId,
          topicSlug: slugByTopicId.get(topicId),
          analysisCreatedAt: r.createdAt,
        }),
      );
    }

    let scannedStreakEntities = 0;
    if (includeStreaks && streakTake > 0) {
      const streakRows = await this.readPrisma.entityTopicStats.findMany({
        where: {
          OR: [
            { currentStreakUp: { gte: thresholds.streakStepsWarn } },
            { currentStreakDown: { gte: thresholds.streakStepsWarn } },
          ],
          updatedAt: { gte: since },
        },
        orderBy: [{ currentStreakUp: 'desc' }, { currentStreakDown: 'desc' }],
        take: streakTake,
        select: {
          entityId: true,
          topicId: true,
          timeWindow: true,
          currentStreakUp: true,
          currentStreakDown: true,
          entity: { select: { canonicalName: true } },
          topic: { select: { slug: true } },
        },
      });

      scannedStreakEntities = streakRows.length;
      for (const s of streakRows) {
        const detectedAt = new Date().toISOString();
        const base = {
          topicId: s.topicId.toString(),
          topicSlug: s.topic.slug,
          entityId: s.entityId.toString(),
          entityName: s.entity.canonicalName,
          detectedAt,
        };
        if (s.currentStreakUp >= thresholds.streakStepsWarn) {
          anomalies.push({
            ...base,
            code: 'entity_streak_improving',
            severity:
              s.currentStreakUp >= thresholds.streakStepsWarn * 2 ? 'critical' : 'warn',
            value: s.currentStreakUp,
            threshold: thresholds.streakStepsWarn,
            message: `${s.entity.canonicalName} 连续 ${s.currentStreakUp} 步名次上升`,
          });
        }
        if (s.currentStreakDown >= thresholds.streakStepsWarn) {
          anomalies.push({
            ...base,
            code: 'entity_streak_declining',
            severity:
              s.currentStreakDown >= thresholds.streakStepsWarn * 2 ? 'critical' : 'warn',
            value: s.currentStreakDown,
            threshold: thresholds.streakStepsWarn,
            message: `${s.entity.canonicalName} 连续 ${s.currentStreakDown} 步名次下降`,
          });
        }
      }
    }

    const deduped = dedupeTrendAnomalies(anomalies);
    return {
      scannedAnalyses: rows.length,
      scannedStreakEntities,
      thresholds,
      status: worstTrendAlertStatus(deduped),
      anomalies: deduped,
      generatedAt: new Date().toISOString(),
    };
  }

  async listAnomaliesForApi(opts: {
    hours?: number;
    timeWindow?: TimeWindow;
    limit?: number;
  }) {
    const scan = await this.scanRecentAnomalies({
      hours: opts.hours,
      timeWindow: opts.timeWindow,
    });
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return toPlainJson({
      filter: {
        hours: opts.hours ?? 48,
        timeWindow: opts.timeWindow ?? null,
        limit: take,
      },
      status: scan.status,
      scannedAnalyses: scan.scannedAnalyses,
      scannedStreakEntities: scan.scannedStreakEntities,
      count: Math.min(scan.anomalies.length, take),
      anomalies: scan.anomalies.slice(0, take),
      thresholds: scan.thresholds,
      generatedAt: scan.generatedAt,
    });
  }

  async persistAnomalyDigest(scan: TrendAnomalyScanResult): Promise<number> {
    if (scan.anomalies.length === 0) return 0;

    const dayKey = new Date().toISOString().slice(0, 10);
    const topicIds = [...new Set(scan.anomalies.map((a) => a.topicId))];
    let written = 0;

    for (const topicIdStr of topicIds) {
      const topicId = BigInt(topicIdStr);
      const existing = await this.prisma.trendAnalysis.findFirst({
        where: {
          topicId,
          entityId: null,
          payload: { path: ['kind'], equals: 'anomaly_digest' },
          createdAt: { gte: new Date(`${dayKey}T00:00:00.000Z`) },
        },
      });
      if (existing) continue;

      const topicAnomalies = scan.anomalies.filter((a) => a.topicId === topicIdStr);
      const payload: Prisma.InputJsonValue = {
        kind: 'anomaly_digest',
        utcDay: dayKey,
        status: worstTrendAlertStatus(topicAnomalies),
        anomalyCount: topicAnomalies.length,
        thresholds: scan.thresholds,
        anomalies: topicAnomalies.slice(0, 30),
        scannedAnalyses: scan.scannedAnalyses,
        generatedAt: scan.generatedAt,
      };

      await this.prisma.trendAnalysis.create({
        data: {
          topicId,
          entityId: null,
          window: 'WEEK',
          payload,
        },
      });
      written += 1;
    }

    if (written > 0) {
      this.logger.log(`anomaly_digest: wrote ${written} topic rows`);
    }
    return written;
  }
}
