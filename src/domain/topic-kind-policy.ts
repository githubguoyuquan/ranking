import type { TopicKind } from '@prisma/client';
import type { DecayParams } from './scoring';
import type { RankingPolicyJson } from './policy-json';

const BASE_WEIGHTS: Record<string, number> = {
  streams: 0.35,
  mentions: 0.25,
  social: 0.2,
  news: 0.2,
};

const PRESETS: Record<
  TopicKind,
  { weights: Record<string, number>; requiredSignalKeys?: string[]; decay: DecayParams }
> = {
  OBJECTIVE: {
    weights: { streams: 0.45, mentions: 0.2, social: 0.15, news: 0.2 },
    requiredSignalKeys: ['streams', 'mentions'],
    decay: { halfLifeDays: 14 },
  },
  SEMI_OBJECTIVE: {
    weights: BASE_WEIGHTS,
    requiredSignalKeys: ['streams', 'mentions', 'news'],
    decay: { halfLifeDays: 10 },
  },
  SUBJECTIVE_TREND: {
    weights: { streams: 0.25, mentions: 0.35, social: 0.3, news: 0.1 },
    requiredSignalKeys: ['mentions', 'social'],
    decay: { halfLifeDays: 5 },
  },
};

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
