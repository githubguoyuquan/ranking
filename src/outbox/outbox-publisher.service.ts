import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { claimOutboxBatchByType } from './outbox-claim';
import {
  KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED,
  OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
} from './outbox.constants';

const FLUSH_BATCH = 80;

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private warnedNoKafka = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastBrokerWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    const n = Number(process.env.OUTBOX_FLUSH_MS);
    const ms = Number.isFinite(n) && n >= 300 ? n : 2000;
    this.interval = setInterval(() => {
      void this.flushOutbox();
    }, ms);
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  /** 租约秒数：抢到行后需在此时长内发完 Kafka，否则可被其他实例接管 */
  private leaseSeconds(): number {
    const n = Number(process.env.OUTBOX_LEASE_SECONDS);
    return Number.isFinite(n) && n >= 15 && n <= 3600 ? n : 120;
  }

  private async flushOutbox(): Promise<void> {
    if (!this.kafka.isConfigured()) {
      if (!this.warnedNoKafka) {
        this.warnedNoKafka = true;
        this.logger.warn(
          'KAFKA_BROKERS not set — outbox rows will accumulate until Kafka is configured.',
        );
      }
      return;
    }

    let claimed: Awaited<ReturnType<typeof claimOutboxBatchByType>>;
    try {
      claimed = await claimOutboxBatchByType(this.prisma, {
        type: OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
        limit: FLUSH_BATCH,
        leaseSeconds: this.leaseSeconds(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Outbox claimBatch failed: ${msg}`);
      return;
    }

    for (const row of claimed) {
      const envelope = {
        type: row.type,
        payload: row.payload,
        meta: {
          outboxId: row.id.toString(),
          createdAt: row.createdAt.toISOString(),
        },
      };

      const key =
        row.type === OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED &&
        typeof row.payload === 'object' &&
        row.payload !== null &&
        'snapshotId' in row.payload
          ? String((row.payload as { snapshotId?: string }).snapshotId ?? row.id)
          : row.id.toString();

      try {
        const ok = await this.kafka.send(KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED, [
          { key, value: JSON.stringify(envelope) },
        ]);
        if (!ok) {
          await this.prisma.outboxEvent.update({
            where: { id: row.id },
            data: {
              attempts: { increment: 1 },
              lastError: 'Kafka not configured',
              leasedUntil: new Date(Date.now() + 30_000),
            },
          });
          return;
        }
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), lastError: null, leasedUntil: null },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const now = Date.now();
        if (now - this.lastBrokerWarnAt > 30_000) {
          this.lastBrokerWarnAt = now;
          this.logger.warn(
            `Outbox publish failed (${msg}). Broker unreachable or down. ` +
              `Fix: start Redpanda (\`docker compose up -d redpanda\`) or remove/comment KAFKA_BROKERS in .env. ` +
              `Row ${row.id} lease extended for backoff.`,
          );
        }
        const backoffSec = Math.min(180, 8 + row.attempts * 6);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            lastError: msg.slice(0, 4000),
            leasedUntil: new Date(Date.now() + backoffSec * 1000),
          },
        });
        break;
      }
    }
  }
}
