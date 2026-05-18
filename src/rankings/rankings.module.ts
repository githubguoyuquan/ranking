import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AgentModule } from '../agent/agent.module';
import { SearchModule } from '../search/search.module';
import { RANKING_FOLLOWUP_QUEUE } from './ranking-followup-job';
import { RankingFollowupProcessor } from './ranking-followup.processor';
import { RANKING_QUEUE } from './ranking-job';
import { RankingProcessor } from './ranking.processor';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';

@Module({
  imports: [
    AnalyticsModule,
    AgentModule,
    SearchModule,
    BullModule.registerQueue({
      name: RANKING_QUEUE,
    }),
    BullModule.registerQueue({
      name: RANKING_FOLLOWUP_QUEUE,
    }),
  ],
  controllers: [RankingsController],
  providers: [RankingsService, RankingProcessor, RankingFollowupProcessor],
  exports: [RankingsService],
})
export class RankingsModule {}
