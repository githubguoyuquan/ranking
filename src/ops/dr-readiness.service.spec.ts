import { describe, expect, it, vi } from 'vitest';
import { DrReadinessService } from './dr-readiness.service';

describe('DrReadinessService', () => {
  it('evaluateReadiness marks postgres failure critical', async () => {
    const svc = new DrReadinessService(
      {
        $queryRaw: vi.fn().mockRejectedValue(new Error('db down')),
        crawlCheckpoint: { count: vi.fn().mockResolvedValue(0) },
      } as never,
      { usesReadReplica: false, $queryRaw: vi.fn() } as never,
      {
        isTablePartitioned: vi.fn().mockResolvedValue(false),
      } as never,
      { remoteCluster: vi.fn().mockReturnValue(null), getCcrStatus: vi.fn() } as never,
      { ping: vi.fn().mockResolvedValue({ ok: true }) } as never,
      { ping: vi.fn().mockResolvedValue({ configured: false, ok: false }) } as never,
      { isEnabled: () => false, ping: vi.fn() } as never,
      { isEnabled: () => false, ping: vi.fn() } as never,
      { isEnabled: () => false, ping: vi.fn() } as never,
      {
        collectMetrics: vi.fn().mockResolvedValue({
          flusher: { pendingTotal: 0, oldestPendingAgeSec: null, byType: [], highAttemptsCount: 0, withLastErrorCount: 0 },
          kafka: { pendingTotal: 0, oldestPendingAgeSec: null, byType: [] },
          kafkaAwaitingAfterFlusher: 0,
        }),
        evaluateAlerts: vi.fn().mockReturnValue([{ code: 'all_ok', severity: 'ok', message: 'ok' }]),
      } as never,
      {
        collectMetrics: vi.fn().mockResolvedValue({
          scheduler: { enabled: false },
          schedulerSla: { staleAfterMinutes: 10, healthy: true },
        }),
      } as never,
    );

    const out = await svc.evaluateReadiness();
    expect(out.status).toBe('critical');
    expect(out.checks.some((c) => c.code === 'postgres_primary')).toBe(true);
  });
});
