import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { bullMqConnectionFromEnv } from '../config/redis';

/**
 * 不可变快照 API 的只读缓存（与 BullMQ 可共用 Redis，建议键前缀隔离）。
 * RANKING_CACHE_ENABLED=false 可关闭；连接/命令失败时静默降级走 DB。
 */
@Injectable()
export class RankingCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RankingCacheService.name);
  private redis: Redis | null = null;
  private warnedUnavailable = false;

  constructor() {
    if (process.env.RANKING_CACHE_ENABLED === 'false') {
      this.logger.log('RANKING_CACHE_ENABLED=false — snapshot read cache off');
      return;
    }
    const conn = bullMqConnectionFromEnv();
    const dbRaw = process.env.RANKING_CACHE_REDIS_DB;
    const db = dbRaw !== undefined && dbRaw !== '' ? Number(dbRaw) : 0;
    this.redis = new Redis({
      host: conn.host,
      port: conn.port,
      password: conn.password,
      username: conn.username,
      db: Number.isFinite(db) ? db : 0,
      maxRetriesPerRequest: 2,
      retryStrategy(times: number) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    this.redis.on('error', (e) => {
      if (!this.warnedUnavailable) {
        this.warnedUnavailable = true;
        this.logger.warn(`Redis ranking cache: ${e.message} (snapshot reads use DB)`);
      }
    });
  }

  isEnabled(): boolean {
    return this.redis !== null && process.env.RANKING_CACHE_ENABLED !== 'false';
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }

  private keySnapshot(id: bigint): string {
    return `ranking:v1:snap:${id.toString()}`;
  }

  private ttlSeconds(): number {
    const n = Number(process.env.RANKING_CACHE_TTL_SECONDS);
    return Number.isFinite(n) && n >= 60 ? n : 604800;
  }

  async getSnapshotJson(id: bigint): Promise<string | null> {
    if (!this.isEnabled()) return null;
    try {
      const s = await this.redis!.get(this.keySnapshot(id));
      return s;
    } catch {
      return null;
    }
  }

  async setSnapshotJson(id: bigint, json: string): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.redis!.set(this.keySnapshot(id), json, 'EX', this.ttlSeconds());
    } catch (e) {
      this.logger.warn(
        `Redis ranking cache SET failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
