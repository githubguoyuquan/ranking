import { Injectable, Logger } from '@nestjs/common';
import { runbookAnchorForCode } from './alert-catalog';
import {
  alertCategoryFromCode,
  alertWebhookConfig,
  resolveWebhookUrl,
} from './alert-webhook.config';
import type {
  AlertDispatchInput,
  AlertDispatchResult,
  AlertSeverity,
  AlertWebhookEnvelopeV1,
  UnifiedAlertItem,
} from './alert-webhook.types';
import type { OpsAlert } from './outbox-lag.service';
import type { TrendAnomalyItem } from '../domain/trend-anomaly';

@Injectable()
export class AlertWebhookRouterService {
  private readonly logger = new Logger(AlertWebhookRouterService.name);
  private readonly lastSentAt = new Map<string, number>();

  getRoutingConfig() {
    const cfg = alertWebhookConfig();
    return {
      disabled: cfg.disabled,
      format: cfg.format,
      cooldownSeconds: cfg.cooldownSeconds,
      runbookBaseUrl: cfg.runbookBaseUrl,
      routes: {
        default: redactUrl(cfg.routes.default ?? cfg.defaultUrl),
        critical: redactUrl(cfg.routes.critical),
        categories: Object.fromEntries(
          Object.entries(cfg.routes.categories ?? {}).map(([k, v]) => [k, redactUrl(v)]),
        ),
        trendLegacyOverride: redactUrl(cfg.trendOverrideUrl),
      },
      bearerTokenConfigured: Boolean(cfg.bearerToken),
    };
  }

  fromOpsAlerts(alerts: OpsAlert[]): UnifiedAlertItem[] {
    return alerts
      .filter((a) => a.severity !== 'ok')
      .map((a) => ({
        code: a.code,
        severity: a.severity as AlertSeverity,
        category: alertCategoryFromCode(a.code),
        message: a.message,
        value: a.value,
        threshold: a.threshold,
        runbookAnchor: runbookAnchorForCode(a.code),
      }));
  }

  fromTrendAnomalies(anomalies: TrendAnomalyItem[]): UnifiedAlertItem[] {
    return anomalies.map((a) => ({
      code: a.code,
      severity: a.severity,
      category: 'trends' as const,
      message: a.message,
      value: a.value,
      threshold: a.threshold,
      topicId: a.topicId,
      topicSlug: a.topicSlug,
      entityId: a.entityId,
      entityName: a.entityName,
      detectedAt: a.detectedAt,
      runbookAnchor: runbookAnchorForCode(a.code),
    }));
  }

  async dispatch(input: AlertDispatchInput): Promise<AlertDispatchResult> {
    const cfg = alertWebhookConfig();
    const result: AlertDispatchResult = {
      sent: 0,
      skippedCooldown: 0,
      skippedNoRoute: false,
      errors: [],
    };

    if (cfg.disabled || input.alerts.length === 0) {
      return result;
    }

    const now = Date.now();
    const due = input.alerts.filter((a) => {
      const key = `${input.category}:${a.code}:${a.severity}`;
      const last = this.lastSentAt.get(key);
      if (last != null && now - last < cfg.cooldownSeconds * 1000) {
        result.skippedCooldown += 1;
        return false;
      }
      return true;
    });

    if (due.length === 0) {
      return result;
    }

    const worst = worstSeverity(due);
    const url = resolveWebhookUrl(cfg, input.category, worst);
    if (!url) {
      result.skippedNoRoute = true;
      return result;
    }

    const envelope = this.buildEnvelope(input, due, worst);
    const payloadFormat = resolvePayloadFormat(cfg, url, worst);
    let body: string;
    try {
      body =
        payloadFormat === 'slack'
          ? JSON.stringify(formatSlackPayload(envelope, cfg.runbookBaseUrl))
          : payloadFormat === 'pagerduty'
            ? JSON.stringify(formatPagerDutyPayload(envelope, cfg.pagerdutyRoutingKey))
            : JSON.stringify(envelope);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      this.logger.warn(`alert payload build failed: ${msg}`);
      return result;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.bearerToken) {
        headers.Authorization = `Bearer ${cfg.bearerToken}`;
      }
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) {
        result.errors.push(`HTTP ${res.status}`);
        this.logger.warn(`alert webhook HTTP ${res.status} → ${redactUrl(url)}`);
        return result;
      }
      result.sent = 1;
      for (const a of due) {
        const key = `${input.category}:${a.code}:${a.severity}`;
        this.lastSentAt.set(key, now);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      this.logger.warn(`alert webhook failed: ${msg}`);
    }

    return result;
  }

  private buildEnvelope(
    input: AlertDispatchInput,
    alerts: UnifiedAlertItem[],
    status: AlertSeverity,
  ): AlertWebhookEnvelopeV1 {
    return {
      envelopeVersion: 1,
      source: input.source,
      category: input.category,
      generatedAt: new Date().toISOString(),
      status,
      environment: {
        drRegion: process.env.DR_REGION?.trim() || null,
        drCluster: process.env.DR_CLUSTER?.trim() || null,
        k8sNamespace: process.env.K8S_NAMESPACE?.trim() || null,
        processRole: process.env.PROCESS_ROLE?.trim() || null,
      },
      alertCount: alerts.length,
      alerts,
      context: input.context,
    };
  }
}

function worstSeverity(alerts: UnifiedAlertItem[]): AlertSeverity {
  return alerts.some((a) => a.severity === 'critical') ? 'critical' : 'warn';
}

function resolvePayloadFormat(
  cfg: ReturnType<typeof alertWebhookConfig>,
  url: string,
  worst: AlertSeverity,
): 'json' | 'slack' | 'pagerduty' {
  if (cfg.format === 'slack') return 'slack';
  if (cfg.format === 'pagerduty') return 'pagerduty';
  if (url.includes('events.pagerduty.com') && worst === 'critical') return 'pagerduty';
  return 'json';
}

function formatPagerDutyPayload(
  envelope: AlertWebhookEnvelopeV1,
  routingKey: string | null,
): {
  routing_key: string;
  event_action: 'trigger';
  payload: {
    summary: string;
    severity: string;
    source: string;
    custom_details: Record<string, unknown>;
  };
} {
  const key = routingKey?.trim();
  if (!key) {
    throw new Error('PAGERDUTY_ROUTING_KEY required for PagerDuty webhook format');
  }
  const summary = `[${envelope.status}] ${envelope.source} — ${envelope.alertCount} alert(s)`;
  return {
    routing_key: key,
    event_action: 'trigger',
    payload: {
      summary,
      severity: envelope.status === 'critical' ? 'critical' : 'warning',
      source: envelope.source,
      custom_details: {
        category: envelope.category,
        alerts: envelope.alerts,
        environment: envelope.environment,
        context: envelope.context,
      },
    },
  };
}

function formatSlackPayload(
  envelope: AlertWebhookEnvelopeV1,
  runbookBaseUrl: string | null,
): { text: string; blocks: unknown[] } {
  const icon = envelope.status === 'critical' ? ':rotating_light:' : ':warning:';
  const lines = envelope.alerts
    .slice(0, 20)
    .map((a) => `• \`${a.code}\` (${a.severity}): ${a.message}`)
    .join('\n');
  const runbook =
    runbookBaseUrl != null
      ? `\n<${runbookBaseUrl}|On-call runbook>`
      : '';
  return {
    text: `${icon} [${envelope.status}] ${envelope.source} — ${envelope.alertCount} alert(s)${runbook}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *${envelope.source}* (${envelope.category})\n*Status:* ${envelope.status} · *Count:* ${envelope.alertCount}${runbook}`,
        },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines || '_no details_' },
      },
    ],
  };
}

function redactUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return '(invalid-url)';
  }
}
