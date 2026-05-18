-- CreateEnum
CREATE TYPE "AiAuditCategory" AS ENUM ('CHAT_COMPLETION', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "AiQuotaDecision" AS ENUM ('ALLOWED', 'DENIED_DAILY_CAP', 'SKIPPED_NO_API_KEY');

-- CreateTable
CREATE TABLE "AiAuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "AiAuditCategory" NOT NULL,
    "operation" VARCHAR(160) NOT NULL,
    "model" VARCHAR(128),
    "snapshotId" BIGINT,
    "aiAnalysisId" BIGINT,
    "success" BOOLEAN NOT NULL,
    "quotaDecision" "AiQuotaDecision",
    "errorMessage" VARCHAR(2000),
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "requestId" VARCHAR(128),
    "source" VARCHAR(32) NOT NULL DEFAULT 'api',
    "metadata" JSONB,

    CONSTRAINT "AiAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAuditEvent_createdAt_idx" ON "AiAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AiAuditEvent_category_createdAt_idx" ON "AiAuditEvent"("category", "createdAt");

-- CreateIndex
CREATE INDEX "AiAuditEvent_snapshotId_createdAt_idx" ON "AiAuditEvent"("snapshotId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAuditEvent_source_createdAt_idx" ON "AiAuditEvent"("source", "createdAt");

-- AddForeignKey
ALTER TABLE "AiAuditEvent" ADD CONSTRAINT "AiAuditEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TopicRankSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAuditEvent" ADD CONSTRAINT "AiAuditEvent_aiAnalysisId_fkey" FOREIGN KEY ("aiAnalysisId") REFERENCES "AiAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
