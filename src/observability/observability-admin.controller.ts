import { Controller, Get, Header } from '@nestjs/common';
import { RequireScopes } from '../compliance/api-key.guard';
import { CrawlOpsService } from './crawl-ops.service';
import { formatPrometheusMetrics } from './observability-prometheus';
import { ObservabilityService } from './observability.service';
import { OutboxLagService } from './outbox-lag.service';

/**
 * 生产可观测：Outbox lag、爬虫调度、Prometheus 抓取。
 * OpenAPI：`docs/openapi/admin-observability.yaml`
 */
@Controller('admin/observability')
@RequireScopes('admin')
export class ObservabilityAdminController {
  constructor(
    private readonly observability: ObservabilityService,
    private readonly outboxLag: OutboxLagService,
    private readonly crawlOps: CrawlOpsService,
  ) {}

  @Get('summary')
  summary() {
    return this.observability.getSummary();
  }

  @Get('outbox')
  async outboxOnly() {
    const outbox = await this.outboxLag.collectMetrics();
    return { outbox, alerts: this.outboxLag.evaluateAlerts(outbox) };
  }

  @Get('crawl')
  async crawlOnly() {
    const crawl = await this.crawlOps.collectMetrics();
    const outbox = await this.outboxLag.collectMetrics();
    return { crawl, alerts: this.outboxLag.evaluateAlerts(outbox, crawl) };
  }

  @Get('prometheus')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async prometheus(): Promise<string> {
    const [outbox, crawl] = await Promise.all([
      this.outboxLag.collectMetrics(),
      this.crawlOps.collectMetrics(),
    ]);
    return formatPrometheusMetrics(outbox, crawl);
  }
}
