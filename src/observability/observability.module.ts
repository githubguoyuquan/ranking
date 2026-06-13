import { Module } from '@nestjs/common';
import { runsOutboxKafkaPublisher, runsOutboxSideEffectFlushers } from '../config/process-role';
import { AlertWebhookRouterService } from './alert-webhook-router.service';
import { CrawlOpsService } from './crawl-ops.service';
import { ObservabilityAdminController } from './observability-admin.controller';
import { ObservabilityAlertCronService } from './observability-alert-cron.service';
import { ObservabilityService } from './observability.service';
import { OutboxLagService } from './outbox-lag.service';

@Module({
  controllers: [ObservabilityAdminController],
  providers: [
    OutboxLagService,
    CrawlOpsService,
    ObservabilityService,
    AlertWebhookRouterService,
    ...(process.env.OBSERVABILITY_ALERT_CRON_DISABLED !== 'true' &&
    (runsOutboxKafkaPublisher() || runsOutboxSideEffectFlushers())
      ? [ObservabilityAlertCronService]
      : []),
  ],
  exports: [ObservabilityService, OutboxLagService, CrawlOpsService, AlertWebhookRouterService],
})
export class ObservabilityModule {}
