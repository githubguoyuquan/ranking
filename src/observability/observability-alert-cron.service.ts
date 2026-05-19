import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { runsOutboxKafkaPublisher } from '../config/process-role';
import { CrawlOpsService } from './crawl-ops.service';
import { OutboxLagService } from './outbox-lag.service';

/**
 * 周期性评估 Outbox / 爬虫调度告警并打日志；可选 Webhook。
 * 禁用：`OBSERVABILITY_ALERT_CRON_DISABLED=true`
 */
@Injectable()
export class ObservabilityAlertCronService {
  private readonly logger = new Logger(ObservabilityAlertCronService.name);

  constructor(
    private readonly outboxLag: OutboxLagService,
    private readonly crawlOps: CrawlOpsService,
  ) {}

  @Cron('*/2 * * * *', { timeZone: 'UTC' })
  async evaluateAndNotify(): Promise<void> {
    if (process.env.OBSERVABILITY_ALERT_CRON_DISABLED === 'true') return;
    if (!runsOutboxKafkaPublisher() && process.env.OBSERVABILITY_ALERT_REQUIRE_WORKER !== 'true') {
      return;
    }

    const [outbox, crawl] = await Promise.all([
      this.outboxLag.collectMetrics(),
      this.crawlOps.collectMetrics(),
    ]);
    const alerts = this.outboxLag.evaluateAlerts(outbox, crawl).filter((a) => a.severity !== 'ok');

    if (alerts.length === 0) return;

    for (const a of alerts) {
      const msg = `[${a.severity}] ${a.code}: ${a.message}`;
      if (a.severity === 'critical') this.logger.error(msg);
      else this.logger.warn(msg);
    }

    const webhook = process.env.OBSERVABILITY_ALERT_WEBHOOK_URL?.trim();
    if (webhook) {
      try {
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'ranking-platform',
            generatedAt: new Date().toISOString(),
            alerts,
            outbox,
            crawl,
          }),
        });
      } catch (e) {
        this.logger.warn(
          `alert webhook failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}
