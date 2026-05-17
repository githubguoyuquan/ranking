import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { bullMqConnectionFromEnv } from './config/redis';
import { HealthController } from './health.controller';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';
import { RankingsModule } from './rankings/rankings.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: bullMqConnectionFromEnv(),
    }),
    PrismaModule,
    OutboxModule,
    RankingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
