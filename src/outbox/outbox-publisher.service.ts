import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { PrismaService } from '../prisma/prisma.service';
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

    const pending = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { id: 'asc' },
      take: FLUSH_BATCH,
    });

    for (const row of pending) {
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
            },
          });
          return;
        }
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), lastError: null },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Outbox ${row.id} publish failed: ${msg}`);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            lastError: msg.slice(0, 4000),
          },
        });
      }
    }
  }
}
