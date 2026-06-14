/**
 * 单体仓库内的进程/限界上下文映射（Phase 1 多进程 → Phase 2 拆服务）。
 * Helm：`api` / `platformWorker` / `crawlWorker` 共用镜像，入口不同。
 */
export type ServiceRole = 'api' | 'worker' | 'crawl' | 'all';

export type BoundedContextManifest = {
  id: string;
  label: string;
  nestModules: string[];
  targetService: string;
  kafkaTopics?: string[];
};

export const BOUNDED_CONTEXTS: BoundedContextManifest[] = [
  {
    id: 'BC_Topic',
    label: '话题与版本',
    nestModules: ['RankingsModule'],
    targetService: 'topic-service',
    kafkaTopics: ['ranking.snapshot.completed'],
  },
  {
    id: 'BC_Rank',
    label: '排行物化',
    nestModules: ['RankingsModule'],
    targetService: 'ranking-service',
    kafkaTopics: ['ranking.snapshot.completed', 'ranking.followup.requested'],
  },
  {
    id: 'BC_Crawl',
    label: '抓取',
    nestModules: ['IngestionModule'],
    targetService: 'crawl-service',
    kafkaTopics: ['crawl.url.fetched'],
  },
  {
    id: 'BC_Search',
    label: '搜索与推荐',
    nestModules: ['SearchModule'],
    targetService: 'search-service',
    kafkaTopics: ['elasticsearch.entity.sync', 'elasticsearch.crawled_url.sync'],
  },
  {
    id: 'BC_AI',
    label: 'Agent 编排',
    nestModules: ['AgentModule', 'AgentOrchestrationModule'],
    targetService: 'ai-orchestration-service',
    kafkaTopics: ['ai.agent.run.completed'],
  },
  {
    id: 'BC_Analytics',
    label: '时序与分析',
    nestModules: ['AnalyticsModule', 'ScaleModule'],
    targetService: 'analytics-service',
    kafkaTopics: ['clickhouse.ranking.snapshot.ingest'],
  },
];

export const PROCESS_ROLE_MANIFEST: Record<
  ServiceRole,
  { entry: string; description: string; loadsWorkers: string[] }
> = {
  api: {
    entry: 'dist/main.js',
    description: 'HTTP /v1、管理台 BFF；无 BullMQ Worker',
    loadsWorkers: [],
  },
  worker: {
    entry: 'dist/platform-worker.main.js',
    description: 'BullMQ 排行/follow-up/ai-agent；Outbox Kafka Producer + ES/CH Flusher',
    loadsWorkers: ['ranking', 'ranking-followup', 'ai-agent', 'outbox-flusher'],
  },
  crawl: {
    entry: 'dist/crawl-worker.main.js',
    description: 'BullMQ crawl 队列；区域分片',
    loadsWorkers: ['crawl'],
  },
  all: {
    entry: 'dist/main.js',
    description: '本地开发：API + 全部 Worker',
    loadsWorkers: ['ranking', 'ranking-followup', 'ai-agent', 'crawl', 'outbox-flusher'],
  },
};

export function currentProcessRole(): ServiceRole {
  const r = process.env.PROCESS_ROLE?.trim().toLowerCase();
  if (r === 'api' || r === 'worker' || r === 'crawl') return r;
  return 'all';
}

/** 运维 / scale status：进程角色与限界上下文目录 */
export function getServiceManifest(): {
  processRole: ServiceRole;
  roleManifest: (typeof PROCESS_ROLE_MANIFEST)[ServiceRole];
  boundedContexts: BoundedContextManifest[];
  kafkaWireFormat: 'json-envelope-v1';
} {
  const processRole = currentProcessRole();
  return {
    processRole,
    roleManifest: PROCESS_ROLE_MANIFEST[processRole],
    boundedContexts: BOUNDED_CONTEXTS,
    kafkaWireFormat: 'json-envelope-v1',
  };
}
