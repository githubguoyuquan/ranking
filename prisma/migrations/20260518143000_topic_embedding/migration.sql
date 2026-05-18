-- CreateTable
CREATE TABLE "TopicEmbedding" (
    "topicId" BIGINT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "dims" INTEGER NOT NULL,
    "vector" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicEmbedding_pkey" PRIMARY KEY ("topicId")
);

-- AddForeignKey
ALTER TABLE "TopicEmbedding" ADD CONSTRAINT "TopicEmbedding_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
