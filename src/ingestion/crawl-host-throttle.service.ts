import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { bullMqConnectionFromEnv } from '../config/redis';

/** 跨 worker 的同 host 最小抓取间隔（分布式 polite crawl） */
export function crawlPerHostMinIntervalMs(): number {
  const n = Number(process.env.CRAWL_PER_HOST_MIN_INTERVAL_MS);
  return Number.isFinite(n) && n >= 0 && n <= 3600_000 ? Math.floor(n) : 0;
}

/**
 * 使用 Redis SET key NX PX 实现同 hostname 节流；未配 REDIS 或间隔为 0 时 no-op。
 */
@Injectable()
export class CrawlHostThrottleService implements OnModuleDestroy {
  private readonly logger = new Logger(CrawlHostThrottleService.name);
  private redis: Redis | null = null;

  constructor() {
    try {
      const o = bullMqConnectionFromEnv();
      this.redis = new Redis({
        host: o.host,
        port: o.port,
        password: o.password,
        username: o.username,
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
    } catch (e) {
      this.logger.warn(
        `Redis throttle disabled: ${e instanceof Error ? e.message : String(e)}`,
      );
      this.redis = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }

  /**
   * 在发起 HTTP 前调用：直到抢到槽位或超时（默认最多等待 intervalMs * 40）。
   */
  async waitForHost(hostname: string): Promise<void> {
    const intervalMs = crawlPerHostMinIntervalMs();
    if (intervalMs <= 0 || !this.redis) return;
    const h = hostname.toLowerCase().slice(0, 253);
    if (!h) return;
    const key = `ranking:crawl:host:${h}`;
    const maxWait = Math.min(intervalMs * 40, 120_000);
    const t0 = Date.now();
    let attempt = 0;
    if (this.redis.status === 'wait') {
      await this.redis.connect().catch(() => undefined);
    }
    while (Date.now() - t0 < maxWait) {
      attempt += 1;
      try {
        const ok = await this.redis.set(key, '1', 'PX', intervalMs, 'NX');
        if (ok === 'OK') return;
      } catch (e) {
        this.logger.warn(`host throttle ${h}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      const delay = Math.min(75 + attempt * 3, 500);
      await new Promise((r) => setTimeout(r, delay));
    }
    this.logger.warn(`host throttle timeout for ${h} after ${maxWait}ms`);
  }
}
