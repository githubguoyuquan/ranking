import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { runsRankingWorkers } from '../config/process-role';
import { TrendAnalysisSchedulerService } from './trend-analysis-scheduler.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AgentOrchestrationModule } from '../agent-orchestration/agent-orchestration.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ScaleModule } from '../scale/scale.module';
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
    AgentOrchestrationModule,
    RealtimeModule,
    SearchModule,
    ScaleModule,
    BullModule.registerQueue({
      name: RANKING_QUEUE,
    }),
    BullModule.registerQueue({
      name: RANKING_FOLLOWUP_QUEUE,
    }),
  ],
  controllers: [RankingsController],
  providers: [
    RankingsService,
    ...(runsRankingWorkers()
      ? [RankingProcessor, RankingFollowupProcessor, TrendAnalysisSchedulerService]
      : []),
  ],
  exports: [RankingsService],
})
export class RankingsModule {}
