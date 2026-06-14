import { Injectable } from '@nestjs/common';
import { ClickhouseService } from '../analytics/clickhouse.service';
import { RedisHealthService } from '../cache/redis-health.service';
import {
  evaluateProductionWiring,
  mergeDrChecks,
  productionWiringEnvFromProcess,
  worstDrStatus,
} from './production-wiring';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReadService } from '../scale/prisma-read.service';
import { PostgresPartitionService } from '../scale/postgres-partition.service';
import { ElasticCcrService } from '../scale/elastic-ccr.service';
import { ElasticService } from '../search/elastic.service';
import { QdrantSearchService } from '../search/qdrant-search.service';
import { CrawlOpsService } from '../observability/crawl-ops.service';
import { OutboxLagService } from '../observability/outbox-lag.service';
import { listKafkaPublishOutboxTypes } from '../kafka/event-registry';
import type { DrCheckItem, DrCheckSeverity } from './dr-readiness.types';

export type { DrCheckItem, DrCheckSeverity } from './dr-readiness.types';

@Injectable()
export class DrReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaRead: PrismaReadService,
    private readonly partitions: PostgresPartitionService,
    private readonly ccr: ElasticCcrService,
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
      const wiring = productionWiringEnvFromProcess();
      checks.push({
        code: 'postgres_read_replica',
        severity: wiring.productionWiringRequired ? 'critical' : 'warn',
        message: 'DATABASE_READ_URL not set — reads use primary',
        hint: 'Configure RDS reader endpoint for DATABASE_READ_URL',
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
      const wiring = productionWiringEnvFromProcess();
      checks.push({
        code: 'kafka',
        severity: wiring.productionWiringRequired ? 'critical' : 'warn',
        message: 'KAFKA_BROKERS not configured',
        hint: 'MSK bootstrap brokers (3 AZ)',
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

      try {
        const tier = await this.clickhouse.queryTierStatus();
        const coldConfigured = Boolean(process.env.CLICKHOUSE_COLD_VOLUME?.trim());
        checks.push({
          code: 'clickhouse_tier',
          severity: coldConfigured ? 'ok' : 'warn',
          message: coldConfigured
            ? `CH cold volume ${String(tier.coldVolume)} configured (hot ${String(tier.hotTtlDays)}d)`
            : 'CLICKHOUSE_COLD_VOLUME not set — hot-only TTL',
          hint: 'POST /admin/scale/clickhouse/ensure-tier after cold volume configured',
        });
      } catch (e) {
        checks.push({
          code: 'clickhouse_tier',
          severity: 'warn',
          message: `CH tier status failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    if (this.elastic.isEnabled()) {
      checks.push({
        code: 'elasticsearch',
        severity: esPing.ok ? 'ok' : 'warn',
        message: esPing.ok
          ? 'Elasticsearch reachable'
          : `Elasticsearch unreachable: ${esPing.detail ?? 'unknown'}`,
      });

      const remote = this.ccr.remoteCluster();
      if (remote) {
        try {
          const ccrStatus = await this.ccr.getCcrStatus();
          checks.push({
            code: 'elasticsearch_ccr',
            severity: ccrStatus.ok === true ? 'ok' : 'warn',
            message: `ES CCR remote cluster: ${remote}`,
            hint: 'POST /admin/scale/elasticsearch/bootstrap-ccr when follower auto-follow ready',
          });
        } catch (e) {
          checks.push({
            code: 'elasticsearch_ccr',
            severity: 'warn',
            message: `ES CCR check failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      } else {
        const wiring = productionWiringEnvFromProcess();
        checks.push({
          code: 'elasticsearch_ccr',
          severity: wiring.productionWiringRequired ? 'warn' : 'ok',
          message: 'ELASTICSEARCH_CCR_REMOTE_CLUSTER not set — no cross-cluster DR follower',
        });
      }
    }

    try {
      const [histPart, crawlPart] = await Promise.all([
        this.partitions.isTablePartitioned('RankingItemHistory'),
        this.partitions.isTablePartitioned('CrawledUrl'),
      ]);
      const wiring = productionWiringEnvFromProcess();
      checks.push({
        code: 'postgres_partitions',
        severity:
          wiring.productionWiringRequired && !(histPart && crawlPart) ? 'warn' : 'ok',
        message:
          histPart && crawlPart
            ? 'RankingItemHistory + CrawledUrl partitioned'
            : `PG partition parents: history=${histPart}, crawledUrl=${crawlPart}`,
        hint: 'Run optional_partition_parent.sql then POST /admin/scale/postgres/ensure-partitions',
      });
    } catch (e) {
      checks.push({
        code: 'postgres_partitions',
        severity: 'warn',
        message: `PG partition check failed: ${e instanceof Error ? e.message : String(e)}`,
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

    const wiringChecks = evaluateProductionWiring(productionWiringEnvFromProcess());
    const allChecks = mergeDrChecks(checks, wiringChecks);
    const status = worstDrStatus(allChecks);
    return {
      status,
      generatedAt: new Date().toISOString(),
      processRole: process.env.PROCESS_ROLE?.trim() || 'all',
      deployment: {
        region: process.env.DR_REGION?.trim() || process.env.CRAWL_SCHEDULER_REGION?.trim() || null,
        cluster: process.env.DR_CLUSTER?.trim() || null,
        k8sNamespace: process.env.K8S_NAMESPACE?.trim() || null,
      },
      checks: allChecks,
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
