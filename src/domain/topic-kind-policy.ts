import type { TopicKind } from '@prisma/client';
import type { DecayParams } from './scoring';
import type { RankingPolicyJson } from './policy-json';

const BASE_WEIGHTS: Record<string, number> = {
  streams: 0.35,
  mentions: 0.25,
  social: 0.2,
  news: 0.2,
};

export type TopicKindPreset = {
  weights: Record<string, number>;
  requiredSignalKeys: string[];
  decay: DecayParams;
  /** 参与排行所需信号覆盖率（required 键中有数据的比例） */
  minCoverageToRank: number;
  description: string;
};

const PRESETS: Record<TopicKind, TopicKindPreset> = {
  OBJECTIVE: {
    weights: { streams: 0.45, mentions: 0.2, social: 0.15, news: 0.2 },
    requiredSignalKeys: ['streams', 'mentions'],
    decay: { halfLifeDays: 14 },
    minCoverageToRank: 1,
    description: '客观榜：必须有 streams 与 mentions 观测；偏重播放量与提及',
  },
  SEMI_OBJECTIVE: {
    weights: BASE_WEIGHTS,
    requiredSignalKeys: ['streams', 'mentions', 'news'],
    decay: { halfLifeDays: 10 },
    minCoverageToRank: 0.67,
    description: '半客观榜：至少 2/3 核心信号；均衡四维权重',
  },
  SUBJECTIVE_TREND: {
    weights: { streams: 0.25, mentions: 0.35, social: 0.3, news: 0.1 },
    requiredSignalKeys: ['mentions', 'social'],
    decay: { halfLifeDays: 5 },
    minCoverageToRank: 1,
    description: '主观趋势榜：必须有 mentions 与 social；短半衰期捕捉舆情',
  },
};

export type SignalRow = {
  metricKey: string;
  observedAt: Date;
};

/** 实体是否具备 TopicKind 要求的信号（按 metricKey 最新观测） */
export function entityHasRequiredSignals(
  metrics: SignalRow[],
  requiredKeys: string[],
  asOf: Date,
): boolean {
  if (requiredKeys.length === 0) return true;
  const latestByKey = new Map<string, SignalRow>();
  for (const row of metrics) {
    if (row.observedAt > asOf) continue;
    const cur = latestByKey.get(row.metricKey);
    if (!cur || row.observedAt > cur.observedAt) latestByKey.set(row.metricKey, row);
  }
  return requiredKeys.every((k) => latestByKey.has(k));
}

export function signalCoverage(
  signalKeys: Iterable<string>,
  requiredKeys: string[],
): number {
  if (requiredKeys.length === 0) return 1;
  const present = new Set(signalKeys);
  const hit = requiredKeys.filter((k) => present.has(k)).length;
  return hit / requiredKeys.length;
}

/** 将 TopicKind 默认权重/decay 与版本 policy 合并（显式 policy 优先） */
export function mergePolicyWithTopicKind(
  kind: TopicKind,
  policy: RankingPolicyJson,
): RankingPolicyJson {
  const preset = PRESETS[kind];
  return {
    ...policy,
    weights: { ...preset.weights, ...policy.weights },
    requiredSignalKeys: policy.requiredSignalKeys ?? preset.requiredSignalKeys,
    decay: policy.decay ?? preset.decay,
  };
}

export function topicKindPreset(kind: TopicKind) {
  return PRESETS[kind];
}

/** 管理台 / GET topic 返回的可读策略摘要 */
export function topicKindStrategyPublic(kind: TopicKind) {
  const p = PRESETS[kind];
  return {
    kind,
    description: p.description,
    weights: p.weights,
    requiredSignalKeys: p.requiredSignalKeys,
    minCoverageToRank: p.minCoverageToRank,
    decay: p.decay,
  };
}
