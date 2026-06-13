import { Injectable } from '@nestjs/common';
import {
  listFlusherOutboxTypes,
  listKafkaPublishOutboxTypes,
} from '../kafka/event-registry';
import { PrismaService } from '../prisma/prisma.service';
import { outboxLagThresholds } from './outbox-lag.config';

export type AlertSeverity = 'ok' | 'warn' | 'critical';

export type OpsAlert = {
  code: string;
  severity: AlertSeverity;
  message: string;
  value?: number;
  threshold?: number;
};

export type OutboxLagMetrics = {
  flusher: {
    pendingTotal: number;
    oldestPendingAgeSec: number | null;
    byType: Array<{ type: string; count: number }>;
    highAttemptsCount: number;
    withLastErrorCount: number;
  };
  kafka: {
    pendingTotal: number;
    oldestPendingAgeSec: number | null;
    byType: Array<{ type: string; count: number }>;
  };
  /** 已刷 Flusher 但 Kafka 未外发（双轨积压） */
  kafkaAwaitingAfterFlusher: number;
};

@Injectable()
export class OutboxLagService {
  constructor(private readonly prisma: PrismaService) {}

  async collectMetrics(): Promise<OutboxLagMetrics> {
    const kafkaTypes = listKafkaPublishOutboxTypes();
    const flusherTypes = listFlusherOutboxTypes();
    const thresholds = outboxLagThresholds();
    const now = Date.now();

    const flusherWhere = {
      publishedAt: null as null,
      type: { in: flusherTypes },
    };

    const [flusherPending, flusherByType, flusherOldest, kafkaPending, kafkaByType, kafkaOldest, highAttempts, withError, kafkaAwaiting] =
      await Promise.all([
        this.prisma.outboxEvent.count({ where: flusherWhere }),
        this.prisma.outboxEvent.groupBy({
          by: ['type'],
          where: flusherWhere,
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
        }),
        this.prisma.outboxEvent.findFirst({
          where: flusherWhere,
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.outboxEvent.count({
          where: {
            kafkaPublishedAt: null,
            type: { in: kafkaTypes },
          },
        }),
        this.prisma.outboxEvent.groupBy({
          by: ['type'],
          where: { kafkaPublishedAt: null, type: { in: kafkaTypes } },
          _count: { id: true },
          orderBy: { _count: { id: 'desc' } },
        }),
        this.prisma.outboxEvent.findFirst({
          where: {
            kafkaPublishedAt: null,
            type: { in: kafkaTypes },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.outboxEvent.count({
          where: {
            ...flusherWhere,
            attempts: { gte: thresholds.highAttemptsWarn },
          },
        }),
        this.prisma.outboxEvent.count({
          where: { ...flusherWhere, lastError: { not: null } },
        }),
        this.prisma.outboxEvent.count({
          where: {
            publishedAt: { not: null },
            kafkaPublishedAt: null,
            type: { in: kafkaTypes },
          },
        }),
      ]);

    return {
      flusher: {
        pendingTotal: flusherPending,
        oldestPendingAgeSec: flusherOldest
          ? Math.floor((now - flusherOldest.createdAt.getTime()) / 1000)
          : null,
        byType: flusherByType.map((r) => ({ type: r.type, count: r._count.id })),
        highAttemptsCount: highAttempts,
        withLastErrorCount: withError,
      },
      kafka: {
        pendingTotal: kafkaPending,
        oldestPendingAgeSec: kafkaOldest
          ? Math.floor((now - kafkaOldest.createdAt.getTime()) / 1000)
          : null,
        byType: kafkaByType.map((r) => ({ type: r.type, count: r._count.id })),
      },
      kafkaAwaitingAfterFlusher: kafkaAwaiting,
    };
  }

  evaluateAlerts(metrics: OutboxLagMetrics, crawl?: CrawlOpsMetrics): OpsAlert[] {
    const t = outboxLagThresholds();
    const alerts: OpsAlert[] = [];

    const flusherAge = metrics.flusher.oldestPendingAgeSec ?? 0;
    if (metrics.flusher.pendingTotal >= t.flusherPendingCritical) {
      alerts.push({
        code: 'outbox_flusher_pending_critical',
        severity: 'critical',
        message: `Outbox Flusher 积压 ${metrics.flusher.pendingTotal} 行`,
        value: metrics.flusher.pendingTotal,
        threshold: t.flusherPendingCritical,
      });
    } else if (metrics.flusher.pendingTotal >= t.flusherPendingWarn) {
      alerts.push({
        code: 'outbox_flusher_pending_warn',
        severity: 'warn',
        message: `Outbox Flusher 积压 ${metrics.flusher.pendingTotal} 行`,
        value: metrics.flusher.pendingTotal,
        threshold: t.flusherPendingWarn,
      });
    }

    if (metrics.flusher.pendingTotal > 0 && flusherAge >= t.flusherOldestCriticalSec) {
      alerts.push({
        code: 'outbox_flusher_lag_critical',
        severity: 'critical',
        message: `最旧未刷 Outbox 已 ${flusherAge}s`,
        value: flusherAge,
        threshold: t.flusherOldestCriticalSec,
      });
    } else if (metrics.flusher.pendingTotal > 0 && flusherAge >= t.flusherOldestWarnSec) {
      alerts.push({
        code: 'outbox_flusher_lag_warn',
        severity: 'warn',
        message: `最旧未刷 Outbox 已 ${flusherAge}s`,
        value: flusherAge,
        threshold: t.flusherOldestWarnSec,
      });
    }

    const kafkaAge = metrics.kafka.oldestPendingAgeSec ?? 0;
    if (metrics.kafka.pendingTotal >= t.kafkaPendingCritical) {
      alerts.push({
        code: 'outbox_kafka_pending_critical',
        severity: 'critical',
        message: `Kafka 未外发 ${metrics.kafka.pendingTotal} 行`,
        value: metrics.kafka.pendingTotal,
        threshold: t.kafkaPendingCritical,
      });
    } else if (metrics.kafka.pendingTotal >= t.kafkaPendingWarn) {
      alerts.push({
        code: 'outbox_kafka_pending_warn',
        severity: 'warn',
        message: `Kafka 未外发 ${metrics.kafka.pendingTotal} 行`,
        value: metrics.kafka.pendingTotal,
        threshold: t.kafkaPendingWarn,
      });
    }

    if (metrics.kafka.pendingTotal > 0 && kafkaAge >= t.kafkaOldestCriticalSec) {
      alerts.push({
        code: 'outbox_kafka_lag_critical',
        severity: 'critical',
        message: `最旧未发 Kafka 已 ${kafkaAge}s`,
        value: kafkaAge,
        threshold: t.kafkaOldestCriticalSec,
      });
    } else if (metrics.kafka.pendingTotal > 0 && kafkaAge >= t.kafkaOldestWarnSec) {
      alerts.push({
        code: 'outbox_kafka_lag_warn',
        severity: 'warn',
        message: `最旧未发 Kafka 已 ${kafkaAge}s`,
        value: kafkaAge,
        threshold: t.kafkaOldestWarnSec,
      });
    }

    if (metrics.flusher.highAttemptsCount > 0) {
      alerts.push({
        code: 'outbox_high_attempts',
        severity: 'warn',
        message: `${metrics.flusher.highAttemptsCount} 行 attempts≥${t.highAttemptsWarn}`,
        value: metrics.flusher.highAttemptsCount,
        threshold: t.highAttemptsWarn,
      });
    }

    if (metrics.flusher.withLastErrorCount > 0) {
      alerts.push({
        code: 'outbox_last_error',
        severity: 'warn',
        message: `${metrics.flusher.withLastErrorCount} 行含 lastError`,
        value: metrics.flusher.withLastErrorCount,
      });
    }

    if (crawl) {
      alerts.push(...this.crawlAlerts(crawl, t));
    }

    if (alerts.length === 0) {
      alerts.push({
        code: 'all_ok',
        severity: 'ok',
        message: '无可观测告警',
      });
    }

    return alerts;
  }

  private crawlAlerts(
    crawl: CrawlOpsMetrics,
    t: ReturnType<typeof outboxLagThresholds>,
  ): OpsAlert[] {
    const alerts: OpsAlert[] = [];
    if (
      crawl.scheduler.enabled &&
      crawl.scheduler.lastScheduleRunAgeSec != null &&
      crawl.scheduler.lastScheduleRunAgeSec > t.crawlSchedulerStaleMin * 60
    ) {
      alerts.push({
        code: 'crawl_scheduler_stale',
        severity: 'warn',
        message: `调度审计无近期记录（>${t.crawlSchedulerStaleMin}min）`,
        value: crawl.scheduler.lastScheduleRunAgeSec,
        threshold: t.crawlSchedulerStaleMin * 60,
      });
    }
    if (crawl.scheduleRuns.failed1h >= t.crawlFailedRuns1hWarn) {
      alerts.push({
        code: 'crawl_schedule_failed_1h',
        severity: 'warn',
        message: `近 1h 调度失败 ${crawl.scheduleRuns.failed1h} 次`,
        value: crawl.scheduleRuns.failed1h,
        threshold: t.crawlFailedRuns1hWarn,
      });
    }
    return alerts;
  }
}

export type CrawlOpsMetrics = {
  scheduler: {
    enabled: boolean;
    region: string | null;
    enabledSources: number;
    lastScheduleRunAt: string | null;
    lastScheduleRunAgeSec: number | null;
  };
  schedulerSla: {
    staleAfterMinutes: number;
    healthy: boolean;
  };
  scheduleRuns: {
    scheduled1h: number;
    skipped1h: number;
    failed1h: number;
  };
  crawlTasks: {
    activeQueued: number;
    activeRunning: number;
    failed24h: number;
  };
  overview: {
    sources: number;
    scheduledSources: number;
    tasksAll: { running: number; failed: number; queued: number };
    urlsByStatus: Record<string, number>;
    recentTasks: Array<{
      id: string;
      sourceId: string;
      status: string;
      createdAt: string;
    }>;
  };
  features: {
    httpFetch: boolean;
    playwright: boolean;
    followLinks: boolean;
    semanticDedup: boolean;
    crossSourceDedup: boolean;
    domFeatures: boolean;
    respectRobots: boolean;
  };
  linkPolicy: {
    followLinks: boolean;
    maxDepth: number;
    maxUrlsPerTask: number;
    respectRobots: boolean;
    allowHosts: string[];
    extractMaxPerPage: number;
  };
  worker: {
    queueShard: string | null;
    queueName: string;
    processRole: string | null;
    scheduledRegions: string[];
  };
  recentRuns: Array<{
    id: string;
    sourceId: string;
    status: string;
    region: string | null;
    scheduledAt: string;
  }>;
};
