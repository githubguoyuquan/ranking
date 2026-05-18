import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { bullMqConnectionFromEnv } from '../config/redis';
import type { RealtimeRankingEvent } from './realtime.types';

const defaultChannel = 'ranking:realtime:v1';

@Injectable()
export class RealtimePublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimePublisherService.name);
  private readonly redis: Redis;
  private readonly channel: string;

  constructor() {
    this.channel = process.env.REALTIME_REDIS_CHANNEL?.trim() || defaultChannel;
    this.redis = new Redis({
      ...bullMqConnectionFromEnv(),
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'end' || this.redis.status === 'wait') {
      await this.redis.connect();
    }
  }

  async publish(event: RealtimeRankingEvent): Promise<void> {
    if (process.env.REALTIME_PUBLISH_DISABLED === 'true') return;
    try {
      await this.ensureConnected();
      await this.redis.publish(this.channel, JSON.stringify(event));
    } catch (e) {
      this.logger.warn(
        `Redis publish skipped: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  getChannel(): string {
    return this.channel;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.redis.disconnect();
    } catch {
      /* ignore */
    }
  }
}
