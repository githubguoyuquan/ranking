import { Injectable } from '@nestjs/common';
import { ClickhouseService } from '../analytics/clickhouse.service';
import { RedisHealthService } from '../cache/redis-health.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReadService } from '../scale/prisma-read.service';
import { ElasticService } from '../search/elastic.service';
import { QdrantSearchService } from '../search/qdrant-search.service';
import { CrawlOpsService } from '../observability/crawl-ops.service';
import { OutboxLagService } from '../observability/outbox-lag.service';
import { listKafkaPublishOutboxTypes } from '../kafka/event-registry';

export type DrCheckSeverity = 'ok' | 'warn' | 'critical';

export type DrCheckItem = {
  code: string;
  severity: DrCheckSeverity;
  message: string;
  value?: number | string | boolean;
  hint?: string;
};

@Injectable()
export class DrReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaRead: PrismaReadService,
    private readonly redisHealth: RedisHealthService,
    private readonly kafka: KafkaProducerService,
    private readonly clickhouse: ClickhouseService,
    private readonly elastic: ElasticService,
    private readonly qdrant: QdrantSearchService,
    private readonly outboxLag: OutboxLagService,
    private readonly crawlOps: CrawlOpsService,
  ) {}

  async evaluateReadiness(): Promise<{
    status: DrCheckSeverity;
    generatedAt: string;
    processRole: string;
    deployment: {
      region: string | null;
      cluster: string | null;
      k8sNamespace: string | null;
    };
    checks: DrCheckItem[];
    outbox: Awaited<ReturnType<OutboxLagService['collectMetrics']>>;
    crawl: Pick<
      Awaited<ReturnType<CrawlOpsService['collectMetrics']>>,
      'scheduler' | 'schedulerSla'
    >;
  }> {
    const checks: DrCheckItem[] = [];
    const [redis, kafkaPing, chPing, esPing, qdrantPing, outbox, crawl] =
      await Promise.all([
        this.redisHealth.ping(),
        this.kafka.ping(),
        this.clickhouse.ping(),
        this.elastic.ping(),
        this.qdrant.ping(),
        this.outboxLag.collectMetrics(),
        this.crawlOps.collectMetrics(),
      ]);

    let dbOk = false;
    try {
      const rows = await this.prisma.$queryRaw<{ n: number }[]>`SELECT 1 AS n`;
      dbOk = rows[0]?.n === 1;
    } catch {
      dbOk = false;
    }
    checks.push({
      code: 'postgres_primary',
      severity: dbOk ? 'ok' : 'critical',
      message: dbOk ? 'Primary Postgres reachable' : 'Primary Postgres unreachable',
    });

    if (this.prismaRead.usesReadReplica) {
      let readOk = false;
      try {
        const rows = await this.prismaRead.$queryRaw<{ n: number }[]>`SELECT 1 AS n`;
        readOk = rows[0]?.n === 1;
      } catch {
        readOk = false;
      }
      checks.push({
        code: 'postgres_read_replica',
        severity: readOk ? 'ok' : 'critical',
        message: readOk
          ? 'DATABASE_READ_URL replica reachable'
          : 'Read replica configured but unreachable',
      });
    } else {
      checks.push({
        code: 'postgres_read_replica',
        severity: 'warn',
        message: 'DATABASE_READ_URL not set — reads use primary',
        hint: 'Configure read replica URL for DR read scaling',
      });
    }

    checks.push({
      code: 'redis',
      severity: redis.ok ? 'ok' : 'critical',
      message: redis.ok ? 'Redis reachable' : `Redis unreachable: ${redis.detail ?? 'unknown'}`,
    });

    if (kafkaPing.configured) {
      checks.push({
        code: 'kafka',
        severity: kafkaPing.ok ? 'ok' : 'critical',
        message: kafkaPing.ok
          ? 'Kafka broker reachable'
          : `Kafka unreachable: ${kafkaPing.detail ?? 'unknown'}`,
      });
    } else {
      checks.push({
        code: 'kafka',
        severity: 'warn',
        message: 'KAFKA_BROKERS not configured',
        hint: 'Event mesh DR requires cross-AZ Kafka cluster',
      });
    }

    if (this.clickhouse.isEnabled()) {
      checks.push({
        code: 'clickhouse',
        severity: chPing.ok ? 'ok' : 'warn',
        message: chPing.ok
          ? 'ClickHouse reachable'
          : `ClickHouse unreachable: ${chPing.detail ?? 'unknown'}`,
      });
    }

    if (this.elastic.isEnabled()) {
      checks.push({
        code: 'elasticsearch',
        severity: esPing.ok ? 'ok' : 'warn',
        message: esPing.ok
          ? 'Elasticsearch reachable'
          : `Elasticsearch unreachable: ${esPing.detail ?? 'unknown'}`,
      });
    }

    if (this.qdrant.isEnabled()) {
      checks.push({
        code: 'qdrant',
        severity: qdrantPing.ok ? 'ok' : 'warn',
        message: qdrantPing.ok
          ? 'Qdrant reachable'
          : `Qdrant unreachable: ${qdrantPing.detail ?? 'unknown'}`,
      });
    }

    const outboxAlerts = this.outboxLag.evaluateAlerts(outbox, crawl);
    for (const a of outboxAlerts.filter((x) => x.severity !== 'ok')) {
      checks.push({
        code: `outbox_${a.code}`,
        severity: a.severity === 'critical' ? 'critical' : 'warn',
        message: a.message,
        value: a.value,
      });
    }

    if (crawl.schedulerSla && !crawl.schedulerSla.healthy) {
      checks.push({
        code: 'crawl_scheduler_stale',
        severity: 'warn',
        message: `Crawl scheduler SLA stale (>${crawl.schedulerSla.staleAfterMinutes}m since last run)`,
      });
    }

    const checkpointCount = await this.prisma.crawlCheckpoint.count();
    checks.push({
      code: 'crawl_checkpoints',
      severity: checkpointCount > 0 ? 'ok' : 'warn',
      message:
        checkpointCount > 0
          ? `${checkpointCount} crawl checkpoint(s) persisted`
          : 'No crawl checkpoints — incremental resume limited',
      value: checkpointCount,
    });

    const status = worstDrStatus(checks);
    return {
      status,
      generatedAt: new Date().toISOString(),
      processRole: process.env.PROCESS_ROLE?.trim() || 'all',
      deployment: {
        region: process.env.DR_REGION?.trim() || process.env.CRAWL_SCHEDULER_REGION?.trim() || null,
        cluster: process.env.DR_CLUSTER?.trim() || null,
        k8sNamespace: process.env.K8S_NAMESPACE?.trim() || null,
      },
      checks,
      outbox,
      crawl: {
        scheduler: crawl.scheduler,
        schedulerSla: crawl.schedulerSla,
      },
    };
  }

  async k8sProbeSummary(): Promise<{
    ok: boolean;
    probes: Record<string, { ok: boolean; detail?: string }>;
    processRole: string;
    recommended: {
      readinessPath: string;
      livenessPath: string;
      startupPath: string;
    };
  }> {
    const [ready, db, redis, kafka] = await Promise.all([
      this.evaluateReadiness(),
      this.pingDb(),
      this.redisHealth.ping(),
      this.kafka.ping(),
    ]);

    const probes = {
      live: { ok: true },
      ready: {
        ok: ready.status !== 'critical',
        detail: ready.status === 'critical' ? 'critical DR checks failed' : undefined,
      },
      db: db,
      redis: { ok: redis.ok, detail: redis.detail },
      kafka: {
        ok: !kafka.configured || kafka.ok,
        detail: kafka.detail,
      },
    };

    return {
      ok: Object.values(probes).every((p) => p.ok),
      probes,
      processRole: process.env.PROCESS_ROLE?.trim() || 'all',
      recommended: {
        livenessPath: '/health',
        readinessPath: '/health/ready',
        startupPath: '/health/ready',
      },
    };
  }

  async outboxReplayPlan(): Promise<{
    kafkaTypes: string[];
    pendingKafkaTotal: number;
    pendingFlusherTotal: number;
    byKafkaType: Array<{ type: string; count: number }>;
    oldestKafkaPendingAgeSec: number | null;
    hint: string;
  }> {
    const kafkaTypes = listKafkaPublishOutboxTypes();
    const metrics = await this.outboxLag.collectMetrics();
    return {
      kafkaTypes,
      pendingKafkaTotal: metrics.kafka.pendingTotal,
      pendingFlusherTotal: metrics.flusher.pendingTotal,
      byKafkaType: metrics.kafka.byType.map((r) => ({
        type: r.type,
        count: r.count,
      })),
      oldestKafkaPendingAgeSec: metrics.kafka.oldestPendingAgeSec,
      hint:
        'DR replay: set kafkaPublishedAt=NULL for target types; ensure Platform Worker running. See docs/ops/DR_RUNBOOK.md',
    };
  }

  private async pingDb(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const rows = await this.prisma.$queryRaw<{ n: number }[]>`SELECT 1 AS n`;
      return { ok: rows[0]?.n === 1 };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

function worstDrStatus(checks: DrCheckItem[]): DrCheckSeverity {
  if (checks.some((c) => c.severity === 'critical')) return 'critical';
  if (checks.some((c) => c.severity === 'warn')) return 'warn';
  return 'ok';
}
