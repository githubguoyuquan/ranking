export type DrCheckSeverity = 'ok' | 'warn' | 'critical';

export type DrCheckItem = {
  code: string;
  severity: DrCheckSeverity;
  message: string;
  value?: number | string | boolean;
  hint?: string;
};
