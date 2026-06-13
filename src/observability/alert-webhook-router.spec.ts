import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertWebhookRouterService } from './alert-webhook-router.service';

describe('AlertWebhookRouterService', () => {
  let svc: AlertWebhookRouterService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    svc = new AlertWebhookRouterService();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    delete process.env.ALERT_WEBHOOK_DISABLED;
    delete process.env.ALERT_WEBHOOK_COOLDOWN_SECONDS;
    delete process.env.ALERT_WEBHOOK_FORMAT;
    delete process.env.ALERT_WEBHOOK_ROUTES;
    delete process.env.TREND_ANOMALY_ALERT_WEBHOOK_URL;
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/default';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ALERT_WEBHOOK_URL;
  });

  it('posts unified envelope v1', async () => {
    const result = await svc.dispatch({
      source: 'ranking-platform-ops',
      category: 'ops',
      alerts: [
        {
          code: 'outbox_flusher_pending_warn',
          severity: 'warn',
          category: 'outbox',
          message: 'backlog',
        },
      ],
      context: { outbox: { pending: 200 } },
    });

    expect(result.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { envelopeVersion: number; alerts: unknown[] };
    expect(body.envelopeVersion).toBe(1);
    expect(body.alerts).toHaveLength(1);
  });

  it('routes trends to category override', async () => {
    process.env.ALERT_WEBHOOK_ROUTES = JSON.stringify({
      default: 'https://hooks.example.com/default',
      categories: { trends: 'https://hooks.example.com/trends' },
    });

    await svc.dispatch({
      source: 'ranking-platform-trends',
      category: 'trends',
      alerts: [
        {
          code: 'entity_rank_surge',
          severity: 'warn',
          category: 'trends',
          message: 'jump',
        },
      ],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://hooks.example.com/trends');
  });

  it('respects cooldown for same code', async () => {
    process.env.ALERT_WEBHOOK_COOLDOWN_SECONDS = '600';
    const input = {
      source: 'ranking-platform-ops',
      category: 'ops' as const,
      alerts: [
        {
          code: 'crawl_scheduler_stale',
          severity: 'warn' as const,
          category: 'crawl' as const,
          message: 'stale',
        },
      ],
    };

    expect((await svc.dispatch(input)).sent).toBe(1);
    expect((await svc.dispatch(input)).sent).toBe(0);
    expect((await svc.dispatch(input)).skippedCooldown).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('formats slack payload when configured', async () => {
    process.env.ALERT_WEBHOOK_FORMAT = 'slack';
    await svc.dispatch({
      source: 'ranking-platform-ops',
      category: 'ops',
      alerts: [
        {
          code: 'outbox_kafka_pending_critical',
          severity: 'critical',
          category: 'outbox',
          message: 'kafka backlog',
        },
      ],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { text: string; blocks: unknown[] };
    expect(body.text).toContain('critical');
    expect(body.blocks.length).toBeGreaterThan(0);
  });
});
