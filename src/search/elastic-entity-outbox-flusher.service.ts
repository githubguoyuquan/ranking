import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { claimOutboxBatchByType } from '../outbox/outbox-claim';
import { OUTBOX_TYPE_ELASTIC_ENTITY_SYNC } from '../outbox/outbox.constants';
import { ElasticService } from './elastic.service';
import type { ElasticEntitySyncPayload } from './elastic-entity-outbox';

const FLUSH_BATCH = 80;

@Injectable()
export class ElasticEntityOutboxFlusherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ElasticEntityOutboxFlusherService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly elastic: ElasticService,
  ) {}

  onModuleInit(): void {
    const n = Number(process.env.OUTBOX_FLUSH_MS);
    const ms = Number.isFinite(n) && n >= 300 ? n : 2000;
    this.interval = setInterval(() => {
      void this.flush();
    }, ms);
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private leaseSeconds(): number {
    const n = Number(process.env.OUTBOX_LEASE_SECONDS);
    return Number.isFinite(n) && n >= 15 && n <= 3600 ? n : 120;
  }

  private async flush(): Promise<void> {
    if (!this.elastic.isEnabled()) return;

    let claimed;
    try {
      claimed = await claimOutboxBatchByType(this.prisma, {
        type: OUTBOX_TYPE_ELASTIC_ENTITY_SYNC,
        limit: FLUSH_BATCH,
        leaseSeconds: this.leaseSeconds(),
      });
    } catch (e) {
      this.logger.error(
        `Elasticsearch entity outbox claim failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    for (const row of claimed) {
      const payload = row.payload as Partial<ElasticEntitySyncPayload>;
      const eid = payload?.entityId;
      const action = payload?.action;

      if (!eid || (action !== 'upsert' && action !== 'delete')) {
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            publishedAt: new Date(),
            lastError: 'invalid payload: need entityId + action upsert|delete',
            leasedUntil: null,
          },
        });
        continue;
      }

      try {
        if (action === 'delete') {
          await this.elastic.deleteEntityFromIndexForFlusher(BigInt(eid));
        } else {
          const entity = await this.prisma.entity.findUnique({
            where: { id: BigInt(eid) },
          });
          if (!entity) {
            await this.elastic.deleteEntityFromIndexForFlusher(BigInt(eid));
          } else {
            await this.elastic.upsertEntityFromRow(entity);
          }
        }

        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), lastError: null, leasedUntil: null },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const backoffSec = Math.min(180, 8 + row.attempts * 6);
        this.logger.warn(`Elasticsearch entity outbox row ${row.id}: ${msg}`);
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
