-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduleIntervalMinutes" INTEGER,
ADD COLUMN     "scheduleCron" VARCHAR(64),
ADD COLUMN     "scheduleTimezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
ADD COLUMN     "region" VARCHAR(64),
ADD COLUMN     "schedulePriority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastScheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CrawlScheduleRun" (
    "id" BIGSERIAL NOT NULL,
    "sourceId" BIGINT NOT NULL,
    "crawlTaskId" BIGINT,
    "region" VARCHAR(64),
    "status" VARCHAR(32) NOT NULL,
    "detail" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Source_scheduleEnabled_region_idx" ON "Source"("scheduleEnabled", "region");

-- CreateIndex
CREATE INDEX "CrawlScheduleRun_sourceId_scheduledAt_idx" ON "CrawlScheduleRun"("sourceId", "scheduledAt");

-- CreateIndex
CREATE INDEX "CrawlScheduleRun_scheduledAt_idx" ON "CrawlScheduleRun"("scheduledAt");

-- AddForeignKey
ALTER TABLE "CrawlScheduleRun" ADD CONSTRAINT "CrawlScheduleRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
