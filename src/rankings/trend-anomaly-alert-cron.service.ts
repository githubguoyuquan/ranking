import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { runsRankingWorkers } from '../config/process-role';
import { TrendAnomalyService } from './trend-anomaly.service';

/**
 * 周期性扫描 TrendAnalysis / 连续升降 streak，打日志并可选 Webhook。
 * 禁用：`TREND_ANOMALY_ALERT_CRON_DISABLED=true`
 */
@Injectable()
export class TrendAnomalyAlertCronService {
  private readonly logger = new Logger(TrendAnomalyAlertCronService.name);

  constructor(private readonly trendAnomaly: TrendAnomalyService) {}

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

    const webhook =
      process.env.TREND_ANOMALY_ALERT_WEBHOOK_URL?.trim() ??
      process.env.OBSERVABILITY_ALERT_WEBHOOK_URL?.trim();
    if (!webhook) return;

    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'ranking-platform-trends',
          generatedAt: scan.generatedAt,
          status: scan.status,
          alertCount: scan.anomalies.length,
          alerts: scan.anomalies.slice(0, 50),
          thresholds: scan.thresholds,
          scannedAnalyses: scan.scannedAnalyses,
        }),
      });
    } catch (e) {
      this.logger.warn(
        `trend alert webhook failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
