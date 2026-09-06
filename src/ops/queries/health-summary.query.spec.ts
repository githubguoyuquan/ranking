import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthSummaryQuery } from './health-summary.query';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisHealthService } from '../../cache/redis-health.service';
import type { KafkaProducerService } from '../../kafka/kafka-producer.service';
import type { ElasticService } from '../../search/elastic.service';
import type { ClickhouseService } from '../../analytics/clickhouse.service';
afterEach(() => vi.useRealTimers());
describe('shared health summary', () => {
  it('bounds response latency, coalesces slow probes and distinguishes unconfigured services', async () => {
    vi.useFakeTimers();
    let resolve!: (rows: Array<{ n: number }>) => void;
    const db = { $queryRaw: vi.fn(() => new Promise<Array<{ n: number }>>(done => { resolve = done; })) };
    const redis = { ping: vi.fn().mockResolvedValue({ ok: true, cacheReadsEnabled: false }) };
    const optional = { isConfigured: () => false, isEnabled: () => false, ping: vi.fn() };
    const query = new HealthSummaryQuery(db as unknown as PrismaService, redis as unknown as RedisHealthService,
      optional as unknown as KafkaProducerService, optional as unknown as ElasticService, optional as unknown as ClickhouseService);
    const first = query.get(), second = query.get();
    await vi.advanceTimersByTimeAsync(800);
    const result = await first;
    await second;
    expect(result.status).toBe('degraded');
    expect(result.services.postgresql.status).toBe('timeout');
    expect(result.services.kafka.status).toBe('unconfigured');
    expect(optional.ping).not.toHaveBeenCalled();
    const third = query.get();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    resolve([{ n: 1 }]);
    expect((await third).status).toBe('ok');
    expect((await query.get()).services.redis.cacheReadsEnabled).toBe(false);
    expect(redis.ping).toHaveBeenCalledTimes(1);
  });
});
