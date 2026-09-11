ALTER TABLE "Topic"
  ADD COLUMN "isOnline" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Topic_tenantId_deletedAt_updatedAt_idx"
  ON "Topic"("tenantId", "deletedAt", "updatedAt");
