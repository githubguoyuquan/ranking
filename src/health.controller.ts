import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { RedisHealthService } from './cache/redis-health.service';
import { KafkaEventSchemaService } from './kafka/kafka-event-schema.service';
import { KafkaProducerService } from './kafka/kafka-producer.service';
import { toPlainJson } from './lib/json';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisHealth: RedisHealthService,
    private readonly kafka: KafkaProducerService,
    private readonly kafkaSchemas: KafkaEventSchemaService,
  ) {}

  @Get()
  ok() {
    return { status: 'ok' };
  }

  /**
   * 就绪探针：PostgreSQL + Redis（BullMQ）均需成功；失败时 HTTP 503，便于 K8s readiness。
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    let dbOk = false;
    let dbDetail: string | undefined;
    try {
      const rows = await this.prisma.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT 1 AS n`,
      );
      dbOk = rows[0]?.n === 1;
      if (!dbOk) dbDetail = 'unexpected SELECT 1 result';
    } catch (e) {
      dbDetail = e instanceof Error ? e.message : String(e);
    }

    const redis = await this.redisHealth.ping();
    const redisOk = redis.ok;
    const allOk = dbOk && redisOk;

    if (!allOk) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return toPlainJson({
      ok: allOk,
      checks: {
        postgresql: dbOk,
        redis: redisOk,
      },
      ...(dbDetail ? { dbDetail } : {}),
      ...(redisOk ? {} : { redisDetail: redis.detail }),
      cacheReadsEnabled: redis.cacheReadsEnabled,
    });
  }

  /** PostgreSQL（Prisma）。 */
  @Get('db')
  async db() {
    try {
      const rows = await this.prisma.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT 1 AS n`,
      );
      const hit = rows[0]?.n === 1;
      return toPlainJson({
        ok: hit,
        detail: hit ? undefined : 'unexpected SELECT 1 result',
      });
    } catch (e) {
      return toPlainJson({
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** BullMQ / 读缓存共用 Redis；`cacheReadsEnabled` 反映 `RANKING_CACHE_ENABLED`。 */
  @Get('redis')
  async redis() {
    return toPlainJson(await this.redisHealth.ping());
  }

  /** 可选；未配置 `KAFKA_BROKERS` 时 `configured: false`。含已加载的 Kafka JSON Schema 路由摘要。 */
  @Get('kafka')
  async kafkaHealth() {
    const ping = await this.kafka.ping();
    return toPlainJson({
      ...ping,
      kafkaEvents: this.kafkaSchemas.describeLoaded(),
      schemaValidationSkipped: process.env.KAFKA_SKIP_SCHEMA_VALIDATION === 'true',
    });
  }
}
