import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { claimOutboxBatchByType } from '../outbox/outbox-claim';
import { OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT } from '../outbox/outbox.constants';
import { ClickhouseService } from './clickhouse.service';

const FLUSH_BATCH = 80;

type ChPayload = { snapshotId?: string; schemaVersion?: number };

@Injectable()
export class ClickhouseOutboxFlusherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickhouseOutboxFlusherService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickhouseService,
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
    if (!this.clickhouse.isEnabled()) return;

    let claimed;
    try {
      claimed = await claimOutboxBatchByType(this.prisma, {
        type: OUTBOX_TYPE_CLICKHOUSE_RANKING_SNAPSHOT,
        limit: FLUSH_BATCH,
        leaseSeconds: this.leaseSeconds(),
      });
    } catch (e) {
      this.logger.error(
        `ClickHouse outbox claim failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    for (const row of claimed) {
      const payload = row.payload as ChPayload;
      const sid = payload?.snapshotId;
      if (!sid) {
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            publishedAt: new Date(),
            lastError: 'invalid payload: missing snapshotId',
            leasedUntil: null,
          },
        });
        continue;
      }

      try {
        const snap = await this.prisma.topicRankSnapshot.findUnique({
          where: { id: BigInt(sid) },
          include: {
            items: { orderBy: { rank: 'asc' } },
            topicRanking: { include: { topicVersion: true } },
          },
        });

        if (!snap) {
          await this.prisma.outboxEvent.update({
            where: { id: row.id },
            data: {
              attempts: { increment: 1 },
              lastError: `snapshot ${sid} not found`,
              leasedUntil: new Date(Date.now() + 60_000),
            },
          });
          continue;
        }

        const topicId = snap.topicRanking.topicVersion.topicId;
        const timeWindow = snap.items[0]?.timeWindow ?? snap.topicRanking.timeWindow;

        if (snap.items.length === 0) {
          await this.prisma.outboxEvent.update({
            where: { id: row.id },
            data: { publishedAt: new Date(), lastError: null, leasedUntil: null },
          });
          continue;
        }

        await this.clickhouse.ingestRankingSnapshot({
          snapshotId: snap.id,
          topicId,
          snapshotTime: snap.snapshotTime,
          timeWindow,
          items: snap.items.map((it) => ({
            entityId: it.entityId,
            popularityScore: it.popularityScore,
            rank: it.rank,
          })),
        });

        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date(), lastError: null, leasedUntil: null },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const backoffSec = Math.min(180, 8 + row.attempts * 6);
        this.logger.warn(`ClickHouse outbox row ${row.id}: ${msg}`);
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
