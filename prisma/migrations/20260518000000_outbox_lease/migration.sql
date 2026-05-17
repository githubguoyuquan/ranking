-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN "leasedUntil" TIMESTAMP(3);

-- CreateIndex (claim + retry)
CREATE INDEX "OutboxEvent_publishedAt_leasedUntil_id_idx" ON "OutboxEvent"("publishedAt", "leasedUntil", "id");
