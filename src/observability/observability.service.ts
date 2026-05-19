import { Injectable } from '@nestjs/common';
import { toPlainJson } from '../lib/json';
import { outboxLagThresholds } from './outbox-lag.config';
import { CrawlOpsService } from './crawl-ops.service';
import { OutboxLagService } from './outbox-lag.service';

@Injectable()
export class ObservabilityService {
  constructor(
    private readonly outboxLag: OutboxLagService,
    private readonly crawlOps: CrawlOpsService,
  ) {}

  async getSummary() {
    const [outbox, crawl] = await Promise.all([
      this.outboxLag.collectMetrics(),
      this.crawlOps.collectMetrics(),
    ]);
    const alerts = this.outboxLag.evaluateAlerts(outbox, crawl);
    const worst = alerts.reduce<'ok' | 'warn' | 'critical'>((w, a) => {
      if (a.severity === 'critical') return 'critical';
      if (a.severity === 'warn' && w !== 'critical') return 'warn';
      return w;
    }, 'ok');

    return toPlainJson({
      generatedAt: new Date().toISOString(),
      status: worst,
      thresholds: outboxLagThresholds(),
      outbox,
      crawl,
      alerts,
    });
  }
}
