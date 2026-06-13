import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { bullMqConnectionFromEnv } from '../config/redis';

/** 与 BullMQ 使用同一套 Redis 环境变量；不依赖读缓存是否开启。 */
@Injectable()
export class RedisHealthService {
  async ping(): Promise<{
    ok: boolean;
    detail?: string;
    cacheReadsEnabled: boolean;
  }> {
    const cacheReadsEnabled = process.env.RANKING_CACHE_ENABLED !== 'false';
    const conn = bullMqConnectionFromEnv();
    const redis = new Redis({
      ...conn,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      enableOfflineQueue: false,
    });
    try {
      const pong = await redis.ping();
      return {
        ok: pong === 'PONG',
        detail: pong === 'PONG' ? undefined : `unexpected: ${pong}`,
        cacheReadsEnabled,
      };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
        cacheReadsEnabled,
      };
    } finally {
      redis.disconnect();
    }
  }
}
