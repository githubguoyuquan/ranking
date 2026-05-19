/** 进程角色：微服务/多副本部署时拆分 HTTP 与后台 Worker */
export type ProcessRole = 'all' | 'api' | 'worker' | 'crawl';

export function processRole(): ProcessRole {
  const r = process.env.PROCESS_ROLE?.trim().toLowerCase();
  if (r === 'api' || r === 'worker' || r === 'crawl') return r;
  return 'all';
}

export function runsRankingWorkers(): boolean {
  const r = processRole();
  return r === 'all' || r === 'worker';
}

export function runsCrawlWorkers(): boolean {
  const r = processRole();
  return r === 'all' || r === 'crawl';
}

export function runsAiAgentWorkers(): boolean {
  const r = processRole();
  return r === 'all' || r === 'worker';
}

export function runsOutboxKafkaPublisher(): boolean {
  const r = processRole();
  return r === 'all' || r === 'worker';
}

export function runsOutboxSideEffectFlushers(): boolean {
  const r = processRole();
  return r === 'all' || r === 'worker';
}

/** 全球爬虫 cron 调度（API / platform-worker，不在 crawl-worker） */
export function runsCrawlScheduler(): boolean {
  const r = processRole();
  return r === 'all' || r === 'api' || r === 'worker';
}
