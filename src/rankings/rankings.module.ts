import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CacheModule } from '../cache/cache.module';
import { RANKING_QUEUE } from './ranking-job';
import { RankingProcessor } from './ranking.processor';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

@Module({
  imports: [
    AnalyticsModule,
    CacheModule,
    BullModule.registerQueue({
      name: RANKING_QUEUE,
    }),
  ],
  controllers: [RankingsController],
  providers: [RankingsService, RankingProcessor],
  exports: [RankingsService],
})
export class RankingsModule {}
