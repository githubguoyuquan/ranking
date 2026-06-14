import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildKafkaEnvelopeV1,
  KAFKA_WIRE_FORMAT,
  listKafkaPublishOutboxTypes,
  resolveKafkaMessageKey,
  resolveKafkaTopicForOutboxType,
} from '../kafka/event-registry';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { KafkaEventSchemaService } from '../kafka/kafka-event-schema.service';
import { SchemaRegistryService } from '../kafka/schema-registry.service';
import { buildClickhouseRankingSnapshotOutboxPayload } from '../rankings/clickhouse-ranking-snapshot-outbox-payload';
import { normalizeRankingSnapshotCompletedOutboxPayload } from '../rankings/ranking-snapshot-completed-outbox-payload';
import { buildElasticCrawledUrlSyncOutboxPayload } from '../search/elastic-crawled-url-sync-outbox-payload';
import { buildElasticEntitySyncOutboxPayload } from '../search/elastic-entity-sync-outbox-payload';
import {
  OUTBOX_TYPE_AI_AGENT_RUN_COMPLETED,
  OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
  OUTBOX_TYPE_CRAWL_URL_FETCHED,
  OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC,
  OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
  OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED,
  OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
} from './outbox.constants';
import { claimOutboxBatchForKafkaTypes } from './outbox-claim';

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
    private readonly kafkaEventSchema: KafkaEventSchemaService,
    private readonly schemaRegistry: SchemaRegistryService,
  ) {}

  onModuleInit(): void {
    void this.schemaRegistry.ensureSubjectsRegistered();
    const n = Number(process.env.OUTBOX_FLUSH_MS);
    const ms = Number.isFinite(n) && n >= 300 ? n : 2000;
    this.interval = setInterval(() => {
      void this.flushOutbox();
    }, ms);
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

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

    const types = listKafkaPublishOutboxTypes();
    let claimed: Awaited<ReturnType<typeof claimOutboxBatchForKafkaTypes>>;
    try {
      claimed = await claimOutboxBatchForKafkaTypes(this.prisma, {
        types,
        limit: FLUSH_BATCH,
        leaseSeconds: this.leaseSeconds(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Outbox claimBatch failed: ${msg}`);
      return;
    }

    for (const row of claimed) {
      await this.schemaRegistry.registerPayloadSchema(row.type);
      const payload = await this.payloadForKafkaPublish(row.type, row.payload);
      const v = this.kafkaEventSchema.validateBeforePublish({
        type: row.type,
        payload,
        id: row.id,
        createdAt: row.createdAt,
      });
      if (!v.ok) {
        this.logger.error(`Outbox ${row.id} Kafka schema validation failed: ${v.errors}`);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            lastError: `kafka_schema: ${v.errors}`.slice(0, 4000),
            leasedUntil: new Date(Date.now() + 300_000),
          },
        });
        continue;
      }

      const envelope = buildKafkaEnvelopeV1({
        type: row.type,
        payload,
        outboxId: row.id,
        createdAt: row.createdAt,
      });

      const topic = resolveKafkaTopicForOutboxType(row.type);
      if (!topic) {
        this.logger.error(`No Kafka topic registered for outbox type ${row.type}`);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            lastError: 'kafka: outbox type not in event registry',
            leasedUntil: new Date(Date.now() + 120_000),
          },
        });
        continue;
      }

      const key = resolveKafkaMessageKey(row.type, payload, row.id);

      try {
        const ok = await this.kafka.send(topic, [
          {
            key,
            value: JSON.stringify(envelope),
            headers: {
              'content-type': 'application/json',
              'x-ranking-envelope-version': String(envelope.envelopeVersion),
              'x-ranking-wire-format': KAFKA_WIRE_FORMAT,
              'x-ranking-outbox-type': row.type,
            },
          },
        ]);
        if (!ok) {
          const detail = this.kafka.isConfigured()
            ? 'Kafka producer unavailable (broker down or connecting)'
            : 'KAFKA_BROKERS not set';
          await this.prisma.outboxEvent.update({
            where: { id: row.id },
            data: {
              attempts: { increment: 1 },
              lastError: detail,
              leasedUntil: new Date(Date.now() + 30_000),
            },
          });
          return;
        }
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            kafkaPublishedAt: new Date(),
            lastError: null,
            leasedUntil: null,
          },
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

  private async payloadForKafkaPublish(type: string, raw: unknown): Promise<unknown> {
    if (type === OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED) {
      let normalized = normalizeRankingSnapshotCompletedOutboxPayload(raw);
      const rawObj =
        typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>)
          : null;
      const needsHydration =
        rawObj != null &&
        (typeof rawObj.hasScoreModel !== 'boolean' || !('scoreModelId' in rawObj));

      if (needsHydration && normalized?.snapshotId) {
        try {
          const snap = await this.prisma.topicRankSnapshot.findUnique({
            where: { id: BigInt(normalized.snapshotId) },
            select: { scoreModelId: true },
          });
          if (snap) {
            normalized = normalizeRankingSnapshotCompletedOutboxPayload({
              ...rawObj,
              scoreModelId: snap.scoreModelId,
            });
          }
        } catch {
          /* keep normalized */
        }
      }
      return normalized ?? raw;
    }

    if (type === OUTBOX_TYPE_RANKING_FOLLOWUP_REQUESTED) {
      return raw;
    }

    if (type === OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT) {
      const o =
        typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>)
          : {};
      return buildClickhouseRankingSnapshotOutboxPayload({
        snapshotId: BigInt(String(o.snapshotId ?? '0')),
      });
    }

    if (type === OUTBOX_TYPE_ELASTIC_ENTITY_SYNC) {
      const o =
        typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>)
          : {};
      return buildElasticEntitySyncOutboxPayload(
        BigInt(String(o.entityId ?? '0')),
        (o.action === 'delete' ? 'delete' : 'upsert'),
      );
    }

    if (type === OUTBOX_TYPE_ELASTIC_CRAWLED_URL_SYNC) {
      const o =
        typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>)
          : {};
      return buildElasticCrawledUrlSyncOutboxPayload(
        BigInt(String(o.crawledUrlId ?? '0')),
        (o.action === 'delete' ? 'delete' : 'upsert'),
      );
    }

    if (type === OUTBOX_TYPE_CRAWL_URL_FETCHED) {
      return raw;
    }

    if (type === OUTBOX_TYPE_AI_AGENT_RUN_COMPLETED) {
      return raw;
    }

    return raw;
  }
}
