import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RANKING_QUEUE } from './ranking-job';
import { RankingProcessor } from './ranking.processor';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: RANKING_QUEUE,
    }),
  ],
  controllers: [RankingsController],
  providers: [RankingsService, RankingProcessor],
  exports: [RankingsService],
})
export class RankingsModule {}
