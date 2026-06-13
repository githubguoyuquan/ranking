export type AlertCategory = 'outbox' | 'crawl' | 'trends' | 'ops';

export type AlertSeverity = 'warn' | 'critical';

export type UnifiedAlertItem = {
  code: string;
  severity: AlertSeverity;
  category: AlertCategory;
  message: string;
  value?: number;
  threshold?: number;
  topicId?: string;
  topicSlug?: string;
  entityId?: string;
  entityName?: string;
  detectedAt?: string;
  runbookAnchor?: string;
};

export type AlertDispatchInput = {
  /** Cron / API source label */
  source: string;
  /** Primary category for routing overrides */
  category: AlertCategory;
  alerts: UnifiedAlertItem[];
  context?: Record<string, unknown>;
};

export type AlertWebhookEnvelopeV1 = {
  envelopeVersion: 1;
  source: string;
  category: AlertCategory;
  generatedAt: string;
  status: AlertSeverity;
  environment: {
    drRegion: string | null;
    drCluster: string | null;
    k8sNamespace: string | null;
    processRole: string | null;
  };
  alertCount: number;
  alerts: UnifiedAlertItem[];
  context?: Record<string, unknown>;
};

export type AlertDispatchResult = {
  sent: number;
  skippedCooldown: number;
  skippedNoRoute: boolean;
  errors: string[];
};
