import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ClaimedOutboxRow = {
  id: bigint;
  type: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  publishedAt: Date | null;
  kafkaPublishedAt: Date | null;
  leasedUntil: Date | null;
  attempts: number;
  lastError: string | null;
};

/**
 * SKIP LOCKED + 租约；按 `type` 分流，避免不同消费者抢同一批行。
 */
export async function claimOutboxBatchByType(
  prisma: PrismaService,
  params: { type: string; limit: number; leaseSeconds: number },
): Promise<ClaimedOutboxRow[]> {
  const { type, limit, leaseSeconds } = params;
  return prisma.$queryRaw<ClaimedOutboxRow[]>`
    WITH c AS (
      SELECT id FROM "OutboxEvent"
      WHERE "publishedAt" IS NULL
        AND type = ${type}
        AND ("leasedUntil" IS NULL OR "leasedUntil" < NOW())
      ORDER BY id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS o
    SET "leasedUntil" = NOW() + (${leaseSeconds} * INTERVAL '1 second')
    FROM c
    WHERE o.id = c.id
    RETURNING o.id, o.type, o.payload, o."createdAt", o."publishedAt", o."kafkaPublishedAt", o."leasedUntil", o.attempts, o."lastError"
  `;
}

/** 批量抢占任一 Kafka 路由类型且尚未 Kafka 发布的 Outbox 行 */
export async function claimOutboxBatchForKafkaTypes(
  prisma: PrismaService,
  params: { types: string[]; limit: number; leaseSeconds: number },
): Promise<ClaimedOutboxRow[]> {
  const { types, limit, leaseSeconds } = params;
  if (types.length === 0) return [];
  return prisma.$queryRaw<ClaimedOutboxRow[]>`
    WITH c AS (
      SELECT id FROM "OutboxEvent"
      WHERE "kafkaPublishedAt" IS NULL
        AND type IN (${Prisma.join(types)})
        AND ("leasedUntil" IS NULL OR "leasedUntil" < NOW())
      ORDER BY id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS o
    SET "leasedUntil" = NOW() + (${leaseSeconds} * INTERVAL '1 second')
    FROM c
    WHERE o.id = c.id
    RETURNING o.id, o.type, o.payload, o."createdAt", o."publishedAt", o."kafkaPublishedAt", o."leasedUntil", o.attempts, o."lastError"
  `;
}
