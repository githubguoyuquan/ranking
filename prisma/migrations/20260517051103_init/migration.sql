-- CreateEnum
CREATE TYPE "TopicKind" AS ENUM ('OBJECTIVE', 'SEMI_OBJECTIVE', 'SUBJECTIVE_TREND');

-- CreateEnum
CREATE TYPE "TimeWindow" AS ENUM ('REALTIME', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TrendType" AS ENUM ('SURGE', 'STEADY_UP', 'FLAT', 'VOLATILE', 'STEADY_DOWN', 'DECLINE');

-- CreateTable
CREATE TABLE "Topic" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "TopicKind" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicVersion" (
    "id" BIGSERIAL NOT NULL,
    "topicId" BIGINT NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "policyJson" JSONB NOT NULL,

    CONSTRAINT "TopicVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicRanking" (
    "id" BIGSERIAL NOT NULL,
    "topicVersionId" BIGINT NOT NULL,
    "timeWindow" "TimeWindow" NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicRanking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicRankSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "topicRankingId" BIGINT NOT NULL,
    "snapshotTime" TIMESTAMP(3) NOT NULL,
    "snapshotVersion" TEXT NOT NULL,
    "rankingJson" JSONB NOT NULL,
    "trendSummary" TEXT,
    "generatedByAi" BOOLEAN NOT NULL DEFAULT false,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "scoreModelId" BIGINT,

    CONSTRAINT "TopicRankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingItem" (
    "id" BIGSERIAL NOT NULL,
    "snapshotId" BIGINT NOT NULL,
    "entityId" BIGINT NOT NULL,
    "rank" INTEGER NOT NULL,
    "previousRank" INTEGER,
    "rankChange" INTEGER,
    "trendType" "TrendType" NOT NULL,
    "trendScore" DOUBLE PRECISION NOT NULL,
    "popularityScore" DOUBLE PRECISION NOT NULL,
    "authorityScore" DOUBLE PRECISION NOT NULL,
    "controversyScore" DOUBLE PRECISION NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "timeWindow" "TimeWindow" NOT NULL,
    "snapshotVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingItemHistory" (
    "id" BIGSERIAL NOT NULL,
    "entityId" BIGINT NOT NULL,
    "topicId" BIGINT NOT NULL,
    "timeWindow" "TimeWindow" NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "snapshotId" BIGINT NOT NULL,

    CONSTRAINT "RankingItemHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "aliases" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityMetric" (
    "id" BIGSERIAL NOT NULL,
    "entityId" BIGINT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "sourceTier" INTEGER NOT NULL DEFAULT 3,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricTimeSeriesRef" (
    "id" BIGSERIAL NOT NULL,
    "entityId" BIGINT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "chTable" TEXT NOT NULL,
    "partition" TEXT,

    CONSTRAINT "MetricTimeSeriesRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendAnalysis" (
    "id" BIGSERIAL NOT NULL,
    "topicId" BIGINT NOT NULL,
    "entityId" BIGINT,
    "window" "TimeWindow" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreModel" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreBreakdown" (
    "id" BIGSERIAL NOT NULL,
    "modelId" BIGINT NOT NULL,
    "rankingItemId" BIGINT NOT NULL,
    "component" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "note" TEXT,

    CONSTRAINT "ScoreBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" BIGSERIAL NOT NULL,
    "topicId" BIGINT,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trustTier" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlTask" (
    "id" BIGSERIAL NOT NULL,
    "sourceId" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "cursor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlCheckpoint" (
    "id" BIGSERIAL NOT NULL,
    "crawlerName" TEXT NOT NULL,
    "lastCursor" TEXT,
    "lastUrl" TEXT,
    "lastTopic" TEXT,
    "lastProcessed" TIMESTAMP(3),
    "meta" JSONB,

    CONSTRAINT "CrawlCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawledUrl" (
    "id" BIGSERIAL NOT NULL,
    "sourceId" BIGINT NOT NULL,
    "url" TEXT NOT NULL,
    "urlFingerprint" TEXT NOT NULL,
    "contentHash" TEXT,
    "status" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3),

    CONSTRAINT "CrawledUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" BIGSERIAL NOT NULL,
    "snapshotId" BIGINT NOT NULL,
    "agent" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detailJson" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityRelation" (
    "id" BIGSERIAL NOT NULL,
    "fromId" BIGINT NOT NULL,
    "toId" BIGINT NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "evidence" JSONB,

    CONSTRAINT "EntityRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Topic_slug_key" ON "Topic"("slug");

-- CreateIndex
CREATE INDEX "TopicVersion_topicId_frozen_idx" ON "TopicVersion"("topicId", "frozen");

-- CreateIndex
CREATE UNIQUE INDEX "TopicVersion_topicId_version_key" ON "TopicVersion"("topicId", "version");

-- CreateIndex
CREATE INDEX "TopicRanking_topicVersionId_timeWindow_windowEnd_idx" ON "TopicRanking"("topicVersionId", "timeWindow", "windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TopicRanking_topicVersionId_timeWindow_windowStart_key" ON "TopicRanking"("topicVersionId", "timeWindow", "windowStart");

-- CreateIndex
CREATE INDEX "TopicRankSnapshot_snapshotTime_idx" ON "TopicRankSnapshot"("snapshotTime");

-- CreateIndex
CREATE UNIQUE INDEX "TopicRankSnapshot_topicRankingId_snapshotVersion_key" ON "TopicRankSnapshot"("topicRankingId", "snapshotVersion");

-- CreateIndex
CREATE INDEX "RankingItem_entityId_generatedAt_idx" ON "RankingItem"("entityId", "generatedAt");

-- CreateIndex
CREATE INDEX "RankingItem_snapshotId_rank_idx" ON "RankingItem"("snapshotId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "RankingItem_snapshotId_entityId_key" ON "RankingItem"("snapshotId", "entityId");

-- CreateIndex
CREATE INDEX "RankingItemHistory_topicId_entityId_timeWindow_asOf_idx" ON "RankingItemHistory"("topicId", "entityId", "timeWindow", "asOf");

-- CreateIndex
CREATE INDEX "EntityMetric_entityId_metricKey_observedAt_idx" ON "EntityMetric"("entityId", "metricKey", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetricTimeSeriesRef_entityId_metricKey_key" ON "MetricTimeSeriesRef"("entityId", "metricKey");

-- CreateIndex
CREATE INDEX "TrendAnalysis_topicId_entityId_createdAt_idx" ON "TrendAnalysis"("topicId", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoreBreakdown_rankingItemId_idx" ON "ScoreBreakdown"("rankingItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlCheckpoint_crawlerName_key" ON "CrawlCheckpoint"("crawlerName");

-- CreateIndex
CREATE UNIQUE INDEX "CrawledUrl_urlFingerprint_key" ON "CrawledUrl"("urlFingerprint");

-- CreateIndex
CREATE INDEX "AiAnalysis_snapshotId_agent_idx" ON "AiAnalysis"("snapshotId", "agent");

-- CreateIndex
CREATE INDEX "EntityRelation_fromId_relation_idx" ON "EntityRelation"("fromId", "relation");

-- AddForeignKey
ALTER TABLE "TopicVersion" ADD CONSTRAINT "TopicVersion_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRanking" ADD CONSTRAINT "TopicRanking_topicVersionId_fkey" FOREIGN KEY ("topicVersionId") REFERENCES "TopicVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRankSnapshot" ADD CONSTRAINT "TopicRankSnapshot_topicRankingId_fkey" FOREIGN KEY ("topicRankingId") REFERENCES "TopicRanking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRankSnapshot" ADD CONSTRAINT "TopicRankSnapshot_scoreModelId_fkey" FOREIGN KEY ("scoreModelId") REFERENCES "ScoreModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingItem" ADD CONSTRAINT "RankingItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TopicRankSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingItem" ADD CONSTRAINT "RankingItem_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingItemHistory" ADD CONSTRAINT "RankingItemHistory_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMetric" ADD CONSTRAINT "EntityMetric_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreBreakdown" ADD CONSTRAINT "ScoreBreakdown_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ScoreModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreBreakdown" ADD CONSTRAINT "ScoreBreakdown_rankingItemId_fkey" FOREIGN KEY ("rankingItemId") REFERENCES "RankingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawledUrl" ADD CONSTRAINT "CrawledUrl_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TopicRankSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
