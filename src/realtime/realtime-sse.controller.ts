import {
  BadRequestException,
  Controller,
  Logger,
  MessageEvent,
  Query,
  Sse,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Observable } from 'rxjs';
import { bullMqConnectionFromEnv } from '../config/redis';
import { RealtimePublisherService } from './realtime-publisher.service';
import type { RealtimeRankingEvent } from './realtime.types';

function splitCsv(v: string | undefined, maxParts: number): string[] {
  if (!v?.trim()) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxParts);
}

function matchesFilters(
  evt: RealtimeRankingEvent,
  slugSet: Set<string>,
  trSet: Set<string>,
): boolean {
  if (evt.type === 'ping') return true;
  if (evt.type !== 'snapshot_ready' && evt.type !== 'ranking_failed') return false;
  if (slugSet.size > 0 && !slugSet.has(evt.topicSlug)) return false;
  if (trSet.size > 0 && !trSet.has(evt.topicRankingId)) return false;
  return true;
}

@Controller('v1/realtime')
export class RealtimeSseController {
  private readonly logger = new Logger(RealtimeSseController.name);

  constructor(private readonly publisher: RealtimePublisherService) {}

  /**
   * Server-Sent Events：订阅排行物化结果（需 Redis；与 BullMQ 共用 `REDIS_URL`）。
   *
   * Query：`topics`（逗号分隔 slug）与 `topicRankingIds`（逗号分隔十进制 id）**至少其一**。
   */
  @Sse('stream')
  stream(
    @Query('topics') topics?: string,
    @Query('topicRankingIds') topicRankingIds?: string,
  ): Observable<MessageEvent> {
    if (process.env.REALTIME_SSE_DISABLED === 'true') {
      throw new BadRequestException('REALTIME_SSE_DISABLED');
    }
    const slugSet = new Set(splitCsv(topics, 32));
    const trSet = new Set(splitCsv(topicRankingIds, 32));
    if (slugSet.size === 0 && trSet.size === 0) {
      throw new BadRequestException(
        'Provide topics and/or topicRankingIds (comma-separated)',
      );
    }

    const channel = this.publisher.getChannel();
    const heartbeatMs = Number(process.env.REALTIME_SSE_HEARTBEAT_MS ?? '25000');
    const hb = Number.isFinite(heartbeatMs) && heartbeatMs >= 5000 ? heartbeatMs : 25000;

    return new Observable<MessageEvent>((subscriber) => {
      const sub = new Redis({
        ...bullMqConnectionFromEnv(),
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });

      let intervalId: ReturnType<typeof setInterval> | undefined;

      const teardown = () => {
        if (intervalId !== undefined) clearInterval(intervalId);
        intervalId = undefined;
        void sub
          .unsubscribe(channel)
          .catch(() => undefined)
          .finally(() => {
            try {
              sub.disconnect();
            } catch {
              /* ignore */
            }
          });
      };

      void (async () => {
        try {
          await sub.connect();
          sub.on('message', (ch, message) => {
            if (ch !== channel) return;
            try {
              const evt = JSON.parse(message) as RealtimeRankingEvent;
              if (matchesFilters(evt, slugSet, trSet)) {
                subscriber.next({ data: message });
              }
            } catch {
              /* ignore malformed */
            }
          });
          await sub.subscribe(channel);
        } catch (e) {
          this.logger.warn(
            `SSE subscribe failed: ${e instanceof Error ? e.message : String(e)}`,
          );
          subscriber.error(e);
          teardown();
          return;
        }

        intervalId = setInterval(() => {
          subscriber.next({
            data: JSON.stringify({ type: 'ping', ts: Date.now() } satisfies RealtimeRankingEvent),
          });
        }, hb);
      })();

      return () => {
        teardown();
      };
    });
  }
}
