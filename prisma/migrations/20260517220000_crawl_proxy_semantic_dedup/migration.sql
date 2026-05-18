-- AlterTable
ALTER TABLE "Source" ADD COLUMN "httpProxyUrl" VARCHAR(2048);

-- AlterTable
ALTER TABLE "CrawledUrl" ADD COLUMN "duplicateOfId" BIGINT,
ADD COLUMN "previewEmbedding" JSONB,
ADD COLUMN "previewEmbeddingModel" VARCHAR(128);

-- AddForeignKey
ALTER TABLE "CrawledUrl" ADD CONSTRAINT "CrawledUrl_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "CrawledUrl"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "CrawledUrl_sourceId_status_idx" ON "CrawledUrl"("sourceId", "status");
