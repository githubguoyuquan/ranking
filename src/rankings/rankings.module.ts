import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { runsRankingWorkers } from '../config/process-role';
import { TrendAnalysisSchedulerService } from './trend-analysis-scheduler.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AgentOrchestrationModule } from '../agent-orchestration/agent-orchestration.module';
import { ObservabilityModule } from '../observability/observability.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ScaleModule } from '../scale/scale.module';
import { SearchModule } from '../search/search.module';
import { RANKING_FOLLOWUP_QUEUE } from './ranking-followup-job';
import { RankingFollowupProcessor } from './ranking-followup.processor';
import { RANKING_QUEUE } from './ranking-job';
import { RankingProcessor } from './ranking.processor';
import { RankingsController } from './rankings.controller';
import { RankingsService } from './rankings.service';
import { EntityMetricsController } from './entity-metrics.controller';
import { EntityMetricsService } from './entity-metrics.service';
import { TrendAnomalyAlertCronService } from './trend-anomaly-alert-cron.service';
import { TrendAnomalyService } from './trend-anomaly.service';

@Module({
  imports: [
    AnalyticsModule,
    AgentOrchestrationModule,
    ObservabilityModule,
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
  controllers: [RankingsController, EntityMetricsController],
  providers: [
    RankingsService,
    EntityMetricsService,
    TrendAnomalyService,
    ...(runsRankingWorkers()
      ? [
          RankingProcessor,
          RankingFollowupProcessor,
          TrendAnalysisSchedulerService,
          TrendAnomalyAlertCronService,
        ]
      : []),
  ],
  exports: [RankingsService, EntityMetricsService, TrendAnomalyService],
})
export class RankingsModule {}
