ALTER TABLE "OutboxEvent" ADD COLUMN "kafkaPublishedAt" TIMESTAMP(3);

CREATE INDEX "OutboxEvent_kafkaPublishedAt_id_idx" ON "OutboxEvent"("kafkaPublishedAt", "id");
