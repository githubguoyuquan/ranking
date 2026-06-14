import type { AlertCategory } from './alert-webhook.types';

export type AlertWebhookRoutes = {
  default?: string;
  critical?: string;
  categories?: Partial<Record<AlertCategory, string>>;
};

export type AlertWebhookConfig = {
  disabled: boolean;
  defaultUrl: string | null;
  routes: AlertWebhookRoutes;
  bearerToken: string | null;
  cooldownSeconds: number;
  format: 'json' | 'slack' | 'pagerduty';
  runbookBaseUrl: string | null;
  pagerdutyRoutingKey: string | null;
  /** Legacy per-domain overrides (backward compat) */
  trendOverrideUrl: string | null;
};

export function alertWebhookConfig(): AlertWebhookConfig {
  return {
    disabled: process.env.ALERT_WEBHOOK_DISABLED === 'true',
    defaultUrl: resolveDefaultUrl(),
    routes: parseRoutes(),
    bearerToken: process.env.ALERT_WEBHOOK_BEARER_TOKEN?.trim() || null,
    cooldownSeconds: numEnv('ALERT_WEBHOOK_COOLDOWN_SECONDS', 300),
    format: parseAlertFormat(process.env.ALERT_WEBHOOK_FORMAT),
    runbookBaseUrl:
      process.env.ALERT_RUNBOOK_BASE_URL?.trim() ||
      'https://github.com/githubguoyuquan/ranking/blob/main/docs/ops/ALERT_ONCALL_RUNBOOK.md',
    pagerdutyRoutingKey: process.env.PAGERDUTY_ROUTING_KEY?.trim() || null,
    trendOverrideUrl: process.env.TREND_ANOMALY_ALERT_WEBHOOK_URL?.trim() || null,
  };
}

export function resolveWebhookUrl(
  cfg: AlertWebhookConfig,
  category: AlertCategory,
  worst: 'warn' | 'critical',
): string | null {
  if (cfg.disabled) return null;

  const categoryUrl = cfg.routes.categories?.[category];
  if (categoryUrl) return categoryUrl;

  if (category === 'trends' && cfg.trendOverrideUrl) {
    return cfg.trendOverrideUrl;
  }

  if (worst === 'critical' && cfg.routes.critical) {
    return cfg.routes.critical;
  }

  return cfg.routes.default ?? cfg.defaultUrl;
}

export function alertCategoryFromCode(code: string): AlertCategory {
  if (code.startsWith('outbox_')) return 'outbox';
  if (code.startsWith('crawl_')) return 'crawl';
  if (
    code.startsWith('entity_') ||
    code.startsWith('snapshot_') ||
    code === 'trend_digest'
  ) {
    return 'trends';
  }
  return 'ops';
}

function resolveDefaultUrl(): string | null {
  return (
    process.env.ALERT_WEBHOOK_URL?.trim() ||
    process.env.OBSERVABILITY_ALERT_WEBHOOK_URL?.trim() ||
    null
  );
}

function parseRoutes(): AlertWebhookRoutes {
  const raw = process.env.ALERT_WEBHOOK_ROUTES?.trim();
  if (!raw) {
    const defaultUrl = resolveDefaultUrl();
    return defaultUrl ? { default: defaultUrl } : {};
  }
  try {
    const parsed = JSON.parse(raw) as AlertWebhookRoutes;
    if (!parsed.default && resolveDefaultUrl()) {
      parsed.default = resolveDefaultUrl()!;
    }
    return parsed;
  } catch {
    return resolveDefaultUrl() ? { default: resolveDefaultUrl()! } : {};
  }
}

function numEnv(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseAlertFormat(raw: string | undefined): AlertWebhookConfig['format'] {
  const v = raw?.trim().toLowerCase();
  if (v === 'slack') return 'slack';
  if (v === 'pagerduty') return 'pagerduty';
  return 'json';
}
