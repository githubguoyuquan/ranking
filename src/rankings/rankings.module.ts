import { TopicRankingQuery } from './queries/topic-ranking.query';
import { TopicOverviewQuery } from './queries/topic-overview.query';
import { SnapshotContextQuery } from './queries/snapshot-context.query';
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
import { OpsAnalyticsController } from './ops-analytics.controller';
import { OpsAnalyticsService } from './ops-analytics.service';
import { TrendAnomalyAlertCronService } from './trend-anomaly-alert-cron.service';
import { TrendAnomalyService } from './trend-anomaly.service';
import { TopicEntityDiscoveryService } from './topic-entity-discovery.service';
import { TopicEntityAutofillService } from './topic-entity-autofill.service';
import { TopicEntityAutofillProcessor } from './topic-entity-autofill.processor';
import { TOPIC_ENTITY_AUTOFILL_QUEUE } from './topic-entity-autofill-job';

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
    BullModule.registerQueue({ name: TOPIC_ENTITY_AUTOFILL_QUEUE }),
  ],
  controllers: [RankingsController, EntityMetricsController, OpsAnalyticsController],
  providers: [
    TopicRankingQuery, TopicOverviewQuery, SnapshotContextQuery,
    RankingsService,
    TopicEntityDiscoveryService,
    TopicEntityAutofillService,
    EntityMetricsService,
    OpsAnalyticsService,
    TrendAnomalyService,
    ...(runsRankingWorkers()
      ? [
          RankingProcessor,
          TopicEntityAutofillProcessor,
          RankingFollowupProcessor,
          TrendAnalysisSchedulerService,
          TrendAnomalyAlertCronService,
        ]
      : []),
  ],
  exports: [RankingsService, EntityMetricsService, TrendAnomalyService],
})
export class RankingsModule {}
