import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { runsRankingWorkers } from '../config/process-role';
import { AlertWebhookRouterService } from '../observability/alert-webhook-router.service';
import { TrendAnomalyService } from './trend-anomaly.service';

/**
 * 周期性扫描 TrendAnalysis / 连续升降 streak，打日志并经统一 Webhook 路由外发。
 * 禁用：`TREND_ANOMALY_ALERT_CRON_DISABLED=true`
 */
@Injectable()
export class TrendAnomalyAlertCronService {
  private readonly logger = new Logger(TrendAnomalyAlertCronService.name);

  constructor(
    private readonly trendAnomaly: TrendAnomalyService,
    private readonly alertRouter: AlertWebhookRouterService,
  ) {}

  @Cron('*/10 * * * *', { timeZone: 'UTC' })
  async evaluateAndNotify(): Promise<void> {
    if (process.env.TREND_ANOMALY_ALERT_CRON_DISABLED === 'true') return;
    if (!runsRankingWorkers() && process.env.TREND_ANOMALY_ALERT_REQUIRE_WORKER !== 'true') {
      return;
    }

    const scan = await this.trendAnomaly.scanRecentAnomalies({ hours: 24 });
    if (scan.anomalies.length === 0) return;

    for (const a of scan.anomalies) {
      const msg = `[trend:${a.severity}] ${a.code}: ${a.message}`;
      if (a.severity === 'critical') this.logger.error(msg);
      else this.logger.warn(msg);
    }

    if (process.env.TREND_ANOMALY_PERSIST_DIGEST === 'true') {
      await this.trendAnomaly.persistAnomalyDigest(scan);
    }

    const unified = this.alertRouter.fromTrendAnomalies(scan.anomalies);
    await this.alertRouter.dispatch({
      source: 'ranking-platform-trends',
      category: 'trends',
      alerts: unified,
      context: {
        status: scan.status,
        scannedAnalyses: scan.scannedAnalyses,
        scannedStreakEntities: scan.scannedStreakEntities,
        thresholds: scan.thresholds,
      },
    });
  }
}
