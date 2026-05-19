import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { bullMqConnectionFromEnv } from './config/redis';
import { IngestionModule } from './ingestion/ingestion.module';
import { AgentOrchestrationModule } from './agent-orchestration/agent-orchestration.module';
import { PrismaModule } from './prisma/prisma.module';
import { SearchModule } from './search/search.module';

/**
 * 仅拉起 Prisma + Search（ES/Embedding Outbox）+ 抓取队列 Worker，**无 HTTP API**。
 * 与 API 进程共用同一 `REDIS_URL` 即可水平扩展消费 `crawl` 队列。
 */
@Module({
  imports: [
    BullModule.forRoot({
      connection: bullMqConnectionFromEnv(),
    }),
    PrismaModule,
    SearchModule,
    AgentOrchestrationModule,
    IngestionModule,
  ],
})
export class WorkerAppModule {}
