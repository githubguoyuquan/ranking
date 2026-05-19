/** Outbox / 爬虫调度告警阈值（可通过环境变量覆盖） */
export function outboxLagThresholds() {
  return {
    flusherPendingWarn: numEnv('OUTBOX_PENDING_WARN', 100),
    flusherPendingCritical: numEnv('OUTBOX_PENDING_CRITICAL', 1000),
    flusherOldestWarnSec: numEnv('OUTBOX_LAG_WARN_SECONDS', 300),
    flusherOldestCriticalSec: numEnv('OUTBOX_LAG_CRITICAL_SECONDS', 1800),
    kafkaPendingWarn: numEnv('OUTBOX_KAFKA_PENDING_WARN', 50),
    kafkaPendingCritical: numEnv('OUTBOX_KAFKA_PENDING_CRITICAL', 500),
    kafkaOldestWarnSec: numEnv('OUTBOX_KAFKA_LAG_WARN_SECONDS', 300),
    kafkaOldestCriticalSec: numEnv('OUTBOX_KAFKA_LAG_CRITICAL_SECONDS', 1800),
    highAttemptsWarn: numEnv('OUTBOX_HIGH_ATTEMPTS_WARN', 5),
    crawlSchedulerStaleMin: numEnv('CRAWL_SCHEDULER_STALE_MINUTES', 10),
    crawlFailedRuns1hWarn: numEnv('CRAWL_FAILED_RUNS_1H_WARN', 10),
  };
}

function numEnv(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
