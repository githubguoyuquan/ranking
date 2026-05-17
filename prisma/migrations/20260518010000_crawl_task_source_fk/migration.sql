-- AddForeignKey
ALTER TABLE "CrawlTask" ADD CONSTRAINT "CrawlTask_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
