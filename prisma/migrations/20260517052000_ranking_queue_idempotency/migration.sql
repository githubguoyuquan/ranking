-- AlterTable
ALTER TABLE "TopicRanking" ADD COLUMN "queuedAt" TIMESTAMP(3),
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "TopicRanking" SET "status" = 'queued' WHERE "status" = 'pending';

ALTER TABLE "TopicRanking" ALTER COLUMN "status" SET DEFAULT 'queued';

-- CreateIndex
CREATE UNIQUE INDEX "TopicRankSnapshot_topicRankingId_snapshotTime_key" ON "TopicRankSnapshot"("topicRankingId", "snapshotTime");

-- CreateIndex
CREATE INDEX "TopicRanking_status_idx" ON "TopicRanking"("status");
