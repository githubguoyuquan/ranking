-- Multi-agent orchestration: AgentRun, TopicProposal, TopicMergeAudit

CREATE TABLE "AgentRun" (
    "id" BIGSERIAL NOT NULL,
    "correlationId" VARCHAR(64) NOT NULL,
    "agent" VARCHAR(120) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputJson" JSONB,
    "outputJson" JSONB,
    "snapshotId" BIGINT,
    "topicId" BIGINT,
    "proposalId" BIGINT,
    "parentRunId" BIGINT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicProposal" (
    "id" BIGSERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "suggestedSlug" VARCHAR(128) NOT NULL,
    "suggestedTitle" TEXT NOT NULL,
    "kind" "TopicKind" NOT NULL DEFAULT 'SEMI_OBJECTIVE',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceJson" JSONB NOT NULL,
    "sourceId" BIGINT,
    "clusterKey" VARCHAR(128),
    "approvedTopicId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicMergeAudit" (
    "id" BIGSERIAL NOT NULL,
    "sourceTopicId" BIGINT NOT NULL,
    "targetTopicId" BIGINT NOT NULL,
    "mergedBy" VARCHAR(128) NOT NULL DEFAULT 'system',
    "detailJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicMergeAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TopicProposal_clusterKey_key" ON "TopicProposal"("clusterKey");

CREATE INDEX "AgentRun_correlationId_idx" ON "AgentRun"("correlationId");
CREATE INDEX "AgentRun_agent_status_createdAt_idx" ON "AgentRun"("agent", "status", "createdAt");
CREATE INDEX "AgentRun_snapshotId_idx" ON "AgentRun"("snapshotId");
CREATE INDEX "AgentRun_topicId_idx" ON "AgentRun"("topicId");
CREATE INDEX "AgentRun_proposalId_idx" ON "AgentRun"("proposalId");

CREATE INDEX "TopicProposal_status_createdAt_idx" ON "TopicProposal"("status", "createdAt");
CREATE INDEX "TopicProposal_sourceId_idx" ON "TopicProposal"("sourceId");

CREATE INDEX "TopicMergeAudit_targetTopicId_createdAt_idx" ON "TopicMergeAudit"("targetTopicId", "createdAt");
CREATE INDEX "TopicMergeAudit_sourceTopicId_idx" ON "TopicMergeAudit"("sourceTopicId");

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TopicRankSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TopicProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TopicProposal" ADD CONSTRAINT "TopicProposal_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopicProposal" ADD CONSTRAINT "TopicProposal_approvedTopicId_fkey" FOREIGN KEY ("approvedTopicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TopicMergeAudit" ADD CONSTRAINT "TopicMergeAudit_sourceTopicId_fkey" FOREIGN KEY ("sourceTopicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TopicMergeAudit" ADD CONSTRAINT "TopicMergeAudit_targetTopicId_fkey" FOREIGN KEY ("targetTopicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
