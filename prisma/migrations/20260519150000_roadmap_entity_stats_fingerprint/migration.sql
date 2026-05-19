-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "settingsJson" JSONB;

-- CreateTable
CREATE TABLE "EntityTopicStats" (
    "entityId" BIGINT NOT NULL,
    "topicId" BIGINT NOT NULL,
    "timeWindow" "TimeWindow" NOT NULL,
    "bestRank" INTEGER NOT NULL,
    "worstRank" INTEGER NOT NULL,
    "currentStreakUp" INTEGER NOT NULL DEFAULT 0,
    "currentStreakDown" INTEGER NOT NULL DEFAULT 0,
    "lastRank" INTEGER,
    "lastAsOf" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityTopicStats_pkey" PRIMARY KEY ("entityId","topicId","timeWindow")
);

-- CreateTable
CREATE TABLE "TopicFingerprint" (
    "topicId" BIGINT NOT NULL,
    "simhash" VARCHAR(64) NOT NULL,
    "embeddingModel" VARCHAR(128),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicFingerprint_pkey" PRIMARY KEY ("topicId")
);

-- AddForeignKey
ALTER TABLE "EntityTopicStats" ADD CONSTRAINT "EntityTopicStats_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityTopicStats" ADD CONSTRAINT "EntityTopicStats_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicFingerprint" ADD CONSTRAINT "TopicFingerprint_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "EntityTopicStats_topicId_timeWindow_idx" ON "EntityTopicStats"("topicId", "timeWindow");
