import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ClaimedOutboxRow = {
  id: bigint;
  type: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  publishedAt: Date | null;
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
    RETURNING o.id, o.type, o.payload, o."createdAt", o."publishedAt", o."leasedUntil", o.attempts, o."lastError"
  `;
}
