import { HealthSummaryQuery } from './queries/health-summary.query';
import { Controller, Get } from '@nestjs/common';
import { RequireScopes } from '../compliance/api-key.guard';
import { toPlainJson } from '../lib/json';
import { DrReadinessService } from './dr-readiness.service';

/**
 * DR / K8s 运维 API。
 * OpenAPI：`docs/openapi/admin-ops.yaml`
 */
@Controller('admin/ops')
@RequireScopes('admin')
export class OpsAdminController {
  constructor(private readonly dr: DrReadinessService, private readonly health: HealthSummaryQuery) {}

  @Get('health-summary')
  healthSummary() { return this.health.get(); }

  /** DR 演练 /  failover 前检查清单（PG/Redis/Kafka/Outbox/爬虫 checkpoint） */
  @Get('dr/readiness')
  async drReadiness() {
    return toPlainJson(await this.dr.evaluateReadiness());
  }

  /** K8s 探针聚合（live/ready/db/redis/kafka） */
  @Get('k8s/probes')
  async k8sProbes() {
    return toPlainJson(await this.dr.k8sProbeSummary());
  }

  /** Outbox Kafka 重放计划（只读统计） */
  @Get('dr/outbox-replay-plan')
  async outboxReplayPlan() {
    return toPlainJson(await this.dr.outboxReplayPlan());
  }
}
