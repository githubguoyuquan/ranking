import { describe, expect, it } from 'vitest';
import type { CrawlOpsMetrics, OutboxLagMetrics } from './outbox-lag.service';
import { OutboxLagService } from './outbox-lag.service';

describe('OutboxLagService.evaluateAlerts', () => {
  const svc = new OutboxLagService(null as never);

  const baseOutbox: OutboxLagMetrics = {
    flusher: {
      pendingTotal: 0,
      oldestPendingAgeSec: null,
      byType: [],
      highAttemptsCount: 0,
      withLastErrorCount: 0,
    },
    kafka: {
      pendingTotal: 0,
      oldestPendingAgeSec: null,
      byType: [],
    },
    kafkaAwaitingAfterFlusher: 0,
  };

  const baseCrawl: CrawlOpsMetrics = {
    scheduler: {
      enabled: true,
      region: null,
      enabledSources: 1,
      lastScheduleRunAt: new Date().toISOString(),
      lastScheduleRunAgeSec: 60,
    },
    scheduleRuns: { scheduled1h: 1, skipped1h: 0, failed1h: 0 },
    crawlTasks: { activeQueued: 0, activeRunning: 0, failed24h: 0 },
    recentRuns: [],
  };

  it('returns ok when healthy', () => {
    const alerts = svc.evaluateAlerts(baseOutbox, baseCrawl);
    expect(alerts.some((a) => a.code === 'all_ok')).toBe(true);
  });

  it('warns on flusher backlog', () => {
    const alerts = svc.evaluateAlerts(
      {
        ...baseOutbox,
        flusher: { ...baseOutbox.flusher, pendingTotal: 200 },
      },
      baseCrawl,
    );
    expect(alerts.some((a) => a.code === 'outbox_flusher_pending_warn')).toBe(true);
  });
});
