import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisHealthService } from '../../cache/redis-health.service';
import { KafkaProducerService } from '../../kafka/kafka-producer.service';
import { ElasticService } from '../../search/elastic.service';
import { ClickhouseService } from '../../analytics/clickhouse.service';

export type HealthSample = {
  configured: boolean; ok: boolean; status: 'healthy' | 'unhealthy' | 'unconfigured' | 'timeout';
  checkedAt: string; latencyMs: number; detail?: string; cacheReadsEnabled?: boolean;
};
@Injectable()
export class HealthSummaryQuery {
  private readonly running = new Map<string, Promise<HealthSample>>();
  private readonly samples = new Map<string, { until: number; value: HealthSample }>();
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisHealthService,
    private readonly kafka: KafkaProducerService, private readonly elastic: ElasticService, private readonly clickhouse: ClickhouseService) {}

  private async sample(name: string, configured: boolean, read: () => Promise<{ ok: boolean; cacheReadsEnabled?: boolean }>): Promise<HealthSample> {
    const now = Date.now();
    if (!configured) return { configured: false, ok: false, status: 'unconfigured', checkedAt: new Date(now).toISOString(), latencyMs: 0, detail: 'not set' };
    const cached = this.samples.get(name);
    if (cached && cached.until > now) return cached.value;
    let operation = this.running.get(name);
    if (!operation) {
      operation = (async (): Promise<HealthSample> => {
        try {
          const result = await read();
          return { configured: true, ok: result.ok, status: result.ok ? 'healthy' : 'unhealthy', checkedAt: new Date().toISOString(), latencyMs: Date.now() - now,
            detail: result.ok ? undefined : 'Dependency unavailable', cacheReadsEnabled: result.cacheReadsEnabled };
        } catch {
          return { configured: true, ok: false, status: 'unhealthy', checkedAt: new Date().toISOString(), latencyMs: Date.now() - now, detail: 'Dependency unavailable' };
        }
      })();
      this.running.set(name, operation);
      void operation.then(value => { this.samples.set(name, { until: Date.now() + 5000, value }); this.running.delete(name); });
    }
    // Response budget does not cancel the underlying SDK. Keep its in-flight slot until settled.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<HealthSample>(resolve => {
        timer = setTimeout(() => resolve({ configured: true, ok: false, status: 'timeout', checkedAt: new Date().toISOString(), latencyMs: Date.now() - now, detail: 'Health check timed out' }), 800);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async get() {
    const [postgresql, redis, kafka, elasticsearch, clickhouse] = await Promise.all([
      this.sample('postgresql', true, async () => {
        const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`SELECT 1 AS n`;
        return { ok: rows[0]?.n === 1 };
      }),
      this.sample('redis', true, () => this.redis.ping()),
      this.sample('kafka', this.kafka.isConfigured(), () => this.kafka.ping()),
      this.sample('elasticsearch', this.elastic.isEnabled(), () => this.elastic.ping()),
      this.sample('clickhouse', this.clickhouse.isEnabled(), () => this.clickhouse.ping()),
    ]);
    return { status: [postgresql, redis, kafka, elasticsearch, clickhouse].some(s => s.configured && !s.ok) ? 'degraded' : 'ok',
      services: { api: { configured: true, ok: true, status: 'healthy', checkedAt: new Date().toISOString(), latencyMs: 0 }, postgresql, redis, kafka, elasticsearch, clickhouse } };
  }
}
