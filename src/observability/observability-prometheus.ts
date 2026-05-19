import type { CrawlOpsMetrics, OutboxLagMetrics } from './outbox-lag.service';

/** Prometheus text exposition 0.0.4 */
export function formatPrometheusMetrics(
  outbox: OutboxLagMetrics,
  crawl: CrawlOpsMetrics,
): string {
  const lines: string[] = [];

  const gauge = (name: string, help: string, value: number, labels?: Record<string, string>) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    const labelStr =
      labels && Object.keys(labels).length > 0
        ? `{${Object.entries(labels)
            .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
            .join(',')}}`
        : '';
    lines.push(`${name}${labelStr} ${Number.isFinite(value) ? value : 0}`);
  };

  gauge(
    'ranking_outbox_flusher_pending_total',
    'Outbox rows with publishedAt null',
    outbox.flusher.pendingTotal,
  );
  gauge(
    'ranking_outbox_flusher_oldest_pending_age_seconds',
    'Age of oldest unpublished outbox row',
    outbox.flusher.oldestPendingAgeSec ?? 0,
  );
  gauge(
    'ranking_outbox_kafka_pending_total',
    'Kafka-routed outbox rows with kafkaPublishedAt null',
    outbox.kafka.pendingTotal,
  );
  gauge(
    'ranking_outbox_kafka_oldest_pending_age_seconds',
    'Age of oldest kafka-pending outbox row',
    outbox.kafka.oldestPendingAgeSec ?? 0,
  );
  gauge(
    'ranking_outbox_kafka_after_flusher_pending',
    'Flusher done but kafka not published',
    outbox.kafkaAwaitingAfterFlusher,
  );
  gauge(
    'ranking_outbox_high_attempts_total',
    'Pending outbox rows with high attempts',
    outbox.flusher.highAttemptsCount,
  );

  for (const row of outbox.flusher.byType) {
    gauge(
      'ranking_outbox_flusher_pending_by_type',
      'Pending outbox by type',
      row.count,
      { type: row.type },
    );
  }

  gauge(
    'ranking_crawl_scheduler_enabled',
    '1 if global crawl scheduler enabled',
    crawl.scheduler.enabled ? 1 : 0,
  );
  gauge(
    'ranking_crawl_scheduler_sources_enabled',
    'Sources with scheduleEnabled',
    crawl.scheduler.enabledSources,
  );
  gauge(
    'ranking_crawl_scheduler_last_run_age_seconds',
    'Seconds since last CrawlScheduleRun',
    crawl.scheduler.lastScheduleRunAgeSec ?? -1,
  );
  gauge(
    'ranking_crawl_schedule_failed_1h',
    'Failed schedule runs in last hour',
    crawl.scheduleRuns.failed1h,
  );
  gauge(
    'ranking_crawl_tasks_queued',
    'Crawl tasks queued last 24h still queued',
    crawl.crawlTasks.activeQueued,
  );
  gauge(
    'ranking_crawl_tasks_running',
    'Crawl tasks running last 24h',
    crawl.crawlTasks.activeRunning,
  );
  gauge(
    'ranking_crawl_tasks_failed_24h',
    'Failed crawl tasks in 24h',
    crawl.crawlTasks.failed24h,
  );

  return `${lines.join('\n')}\n`;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
