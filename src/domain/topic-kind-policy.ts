import type { TopicKind } from '@prisma/client';
import type { DecayParams } from './scoring';
import type { RankingPolicyJson } from './policy-json';

export type TopicKindPreset = {
  decay: DecayParams;
  /** 参与排行所需信号覆盖率（required 键中有数据的比例） */
  minCoverageToRank: number;
  description: string;
};

const PRESETS: Record<TopicKind, TopicKindPreset> = {
  OBJECTIVE: {
    decay: { halfLifeDays: 14 },
    minCoverageToRank: 1,
    description: '客观榜：优先可复核的直接数据；具体指标由话题动态决定',
  },
  SEMI_OBJECTIVE: {
    decay: { halfLifeDays: 10 },
    minCoverageToRank: 0.67,
    description: '半客观榜：允许多类证据互相补充；具体指标由话题动态决定',
  },
  SUBJECTIVE_TREND: {
    decay: { halfLifeDays: 5 },
    minCoverageToRank: 1,
    description: '主观趋势榜：强调近期变化并使用较短衰减；具体指标由话题动态决定',
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

/**
 * TopicVersion 的显式指标是权威规则。TopicKind 只补充缺失的衰减和必需信号，
 * 绝不能把固定指标混入一个已经按话题生成的动态方案。
 */
export function mergePolicyWithTopicKind(
  kind: TopicKind,
  policy: RankingPolicyJson,
): RankingPolicyJson {
  const preset = PRESETS[kind];
  return {
    ...policy,
    weights: { ...policy.weights },
    requiredSignalKeys: policy.requiredSignalKeys ?? Object.keys(policy.weights),
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
    minCoverageToRank: p.minCoverageToRank,
    decay: p.decay,
  };
}
