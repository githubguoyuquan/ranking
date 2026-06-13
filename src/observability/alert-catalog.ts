import type { AlertCategory } from './alert-webhook.types';

export type AlertRunbookEntry = {
  category: AlertCategory;
  title: string;
  severityHint: 'warn' | 'critical' | 'both';
  triage: string[];
};

/** Static runbook metadata keyed by alert code (enriched on webhook payloads). */
export const ALERT_RUNBOOK: Record<string, AlertRunbookEntry> = {
  outbox_flusher_pending_warn: {
    category: 'outbox',
    title: 'Outbox Flusher 积压（warn）',
    severityHint: 'warn',
    triage: [
      '确认 Platform Worker 存活：`kubectl get pods -l app.kubernetes.io/component=platform-worker`',
      '查看 `GET /admin/observability/outbox` 按 type 分布',
      '检查 Flusher 日志是否有 ES/CH 连接错误',
    ],
  },
  outbox_flusher_pending_critical: {
    category: 'outbox',
    title: 'Outbox Flusher 积压（critical）',
    severityHint: 'critical',
    triage: [
      '立即确认 Worker 副本数与 Redis 连通',
      '若 ES/CH 不可用，恢复依赖后积压会自动消化',
      '持续 critical 考虑临时扩容 Worker',
    ],
  },
  outbox_flusher_lag_warn: {
    category: 'outbox',
    title: '最旧未刷 Outbox 年龄过长',
    severityHint: 'warn',
    triage: [
      '对比 pending 总数与 oldest age — 少量大行可能阻塞',
      '查 Outbox 表 `lastError` / `attempts` 高的行',
    ],
  },
  outbox_flusher_lag_critical: {
    category: 'outbox',
    title: '最旧未刷 Outbox 严重超时',
    severityHint: 'critical',
    triage: [
      '优先处理 poison message（高 attempts + lastError）',
      '必要时手工 skip 或修复 payload 后重置 attempts',
    ],
  },
  outbox_kafka_pending_warn: {
    category: 'outbox',
    title: 'Kafka 未外发积压',
    severityHint: 'warn',
    triage: [
      '确认 MSK/Kafka 与 Schema Registry 可达',
      'Platform Worker 负责 kafkaPublishedAt 写入',
    ],
  },
  outbox_kafka_pending_critical: {
    category: 'outbox',
    title: 'Kafka 未外发严重积压',
    severityHint: 'critical',
    triage: [
      '检查 `ranking_outbox_kafka_pending` Prometheus 指标',
      'DR 场景见 `GET /admin/ops/dr/outbox-replay-plan`',
    ],
  },
  outbox_kafka_lag_warn: {
    category: 'outbox',
    title: '最旧 Kafka 未外发超时',
    severityHint: 'warn',
    triage: ['确认 Kafka broker 与 ACL', '查看 Outbox publisher 错误日志'],
  },
  outbox_kafka_lag_critical: {
    category: 'outbox',
    title: '最旧 Kafka 未外发严重超时',
    severityHint: 'critical',
    triage: ['执行 outbox replay 计划', '通知下游消费方可能延迟'],
  },
  outbox_high_attempts: {
    category: 'outbox',
    title: 'Outbox 高重试行',
    severityHint: 'warn',
    triage: ['定位 attempts 最高的 type 与 aggregateId', '修复根因后重置或删除 poison 行'],
  },
  outbox_last_error: {
    category: 'outbox',
    title: 'Outbox 存在 lastError',
    severityHint: 'warn',
    triage: ['抽样 lastError 文本', '区分 transient vs 永久失败'],
  },
  crawl_scheduler_stale: {
    category: 'crawl',
    title: '爬虫调度无近期审计',
    severityHint: 'warn',
    triage: [
      '确认 API 或 platform-worker 上 `CRAWL_SCHEDULER_DISABLED` 未误开',
      '查 `CrawlScheduleRun` 最近一条',
      '见 `GET /admin/crawl/overview`',
    ],
  },
  crawl_schedule_failed_1h: {
    category: 'crawl',
    title: '1h 内调度失败过多',
    severityHint: 'warn',
    triage: [
      '查看失败 run 的 error 字段',
      '确认 crawl-worker 与 Redis 队列健康',
    ],
  },
  entity_rank_surge: {
    category: 'trends',
    title: '实体名次大幅上升',
    severityHint: 'both',
    triage: ['核对 snapshot 数据质量', '是否为正常热点事件'],
  },
  entity_rank_plunge: {
    category: 'trends',
    title: '实体名次大幅下降',
    severityHint: 'both',
    triage: ['核对数据源是否缺失', '检查物化过滤是否误伤'],
  },
  snapshot_surge_cluster: {
    category: 'trends',
    title: '快照内 SURGE 实体过多',
    severityHint: 'warn',
    triage: ['查看话题 slug 与 snapshotId', '评估是否为市场-wide 波动'],
  },
  snapshot_volatile_cluster: {
    category: 'trends',
    title: '快照 VOLATILE 占比过高',
    severityHint: 'warn',
    triage: ['检查打分/decay 配置', '对比前后快照 itemCount'],
  },
  snapshot_momentum_imbalance: {
    category: 'trends',
    title: '涨/跌榜数量严重失衡',
    severityHint: 'warn',
    triage: ['确认非单边上榜数据源故障', '查看 trend-analyses API'],
  },
  entity_streak_improving: {
    category: 'trends',
    title: '实体连续上升 streak',
    severityHint: 'warn',
    triage: ['产品/运营关注项，通常无需紧急干预'],
  },
  entity_streak_declining: {
    category: 'trends',
    title: '实体连续下降 streak',
    severityHint: 'warn',
    triage: ['确认实体指标/信源是否断供'],
  },
};

export function runbookAnchorForCode(code: string): string | undefined {
  return ALERT_RUNBOOK[code] ? `#${code}` : undefined;
}
