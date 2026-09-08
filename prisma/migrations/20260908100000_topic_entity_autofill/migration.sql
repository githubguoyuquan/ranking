ALTER TABLE "Entity" ADD COLUMN "externalKey" TEXT;
CREATE UNIQUE INDEX "Entity_externalKey_key" ON "Entity"("externalKey");

CREATE TABLE "TopicEntityAutofill" (
    "topicId" BIGINT NOT NULL,
    "requestedCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "runToken" TEXT NOT NULL,
    "strategy" TEXT,
    "message" TEXT,
    "entities" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TopicEntityAutofill_pkey" PRIMARY KEY ("topicId"),
    CONSTRAINT "TopicEntityAutofill_count_check" CHECK ("requestedCount" BETWEEN 1 AND 50),
    CONSTRAINT "TopicEntityAutofill_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'partial', 'failed')),
    CONSTRAINT "TopicEntityAutofill_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TopicEntityAutofill_status_updatedAt_idx" ON "TopicEntityAutofill"("status", "updatedAt");
