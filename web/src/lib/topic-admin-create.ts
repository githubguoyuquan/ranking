import {
  DECIMAL_BIGINT_ID_MAX_DIGITS,
  isDecimalBigIntIdString,
} from "./decimal-id";
import type { TopicKindValue } from "./topic-kind";

export type TopicMetricDefinition = {
  key: string;
  label: string;
  description: string;
  normalizationGuide: string;
  sourceHints: string[];
};

export type TopicMetricPlan = {
  generatedBy: "local_algorithm" | "openai";
  rationale: string;
  metrics: Array<TopicMetricDefinition & { weight: number; required: boolean }>;
};

export type TopicPolicyWeightInputs = Record<string, string>;
type PolicyRecord = Record<string, unknown>;

// Compatibility only for topics created before dynamic metric plans existed.
const LEGACY_DEFAULTS: Record<
  TopicKindValue,
  { weights: Record<string, number>; requiredSignalKeys: string[] }
> = {
  OBJECTIVE: {
    weights: { streams: 0.45, mentions: 0.2, social: 0.15, news: 0.2 },
    requiredSignalKeys: ["streams", "mentions"],
  },
  SEMI_OBJECTIVE: {
    weights: { streams: 0.35, mentions: 0.25, social: 0.2, news: 0.2 },
    requiredSignalKeys: ["streams", "mentions", "news"],
  },
  SUBJECTIVE_TREND: {
    weights: { streams: 0.25, mentions: 0.35, social: 0.3, news: 0.1 },
    requiredSignalKeys: ["mentions", "social"],
  },
};

const LEGACY_LABELS: Record<string, string> = {
  streams: "播放/使用量",
  mentions: "提及量",
  social: "社交热度",
  news: "新闻热度",
};

export type TopicVersionPolicyForm = {
  basePolicy: PolicyRecord;
  weights: TopicPolicyWeightInputs;
  metricDefinitions: TopicMetricDefinition[];
  requiredSignalKeys: string[];
  entityIdsInput: string;
  usesLegacyFallback: boolean;
};

function recordOf(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

export function parseTopicMetricPlan(raw: unknown): TopicMetricPlan | null {
  const value = recordOf(raw);
  if (!value || !["local_algorithm", "openai"].includes(String(value.generatedBy)) || typeof value.rationale !== "string" || !Array.isArray(value.metrics)) {
    return null;
  }
  const metrics: TopicMetricPlan["metrics"] = [];
  for (const entry of value.metrics) {
    const item = recordOf(entry);
    if (!item) return null;
    const key = String(item.key ?? "").trim();
    const label = String(item.label ?? "").trim();
    const description = String(item.description ?? "").trim();
    const normalizationGuide = String(item.normalizationGuide ?? "").trim();
    const weight = Number(item.weight);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(key) || !label || !description || !normalizationGuide || !Number.isFinite(weight) || weight < 0 || !Array.isArray(item.sourceHints)) {
      return null;
    }
    metrics.push({
      key,
      label,
      description,
      normalizationGuide,
      sourceHints: item.sourceHints.map(String).map((hint) => hint.trim()).filter(Boolean),
      weight,
      required: item.required === true,
    });
  }
  if (metrics.length < 2 || new Set(metrics.map((metric) => metric.key)).size !== metrics.length) return null;
  return { generatedBy: value.generatedBy as TopicMetricPlan["generatedBy"], rationale: value.rationale, metrics };
}

function definitionsForKeys(keys: string[]): TopicMetricDefinition[] {
  return keys.map((key) => ({
    key,
    label: LEGACY_LABELS[key] ?? key,
    description: "旧版本保存的指标。",
    normalizationGuide: "沿用旧版本的数据口径。",
    sourceHints: [],
  }));
}

export function defaultTopicVersionPolicyForm(
  kind: TopicKindValue,
  rawMetricPlan?: unknown,
): TopicVersionPolicyForm {
  const plan = parseTopicMetricPlan(rawMetricPlan);
  if (plan) {
    return {
      basePolicy: {},
      weights: Object.fromEntries(plan.metrics.map((metric) => [metric.key, String(metric.weight)])),
      metricDefinitions: plan.metrics.map(({ weight: _weight, required: _required, ...definition }) => definition),
      requiredSignalKeys: plan.metrics.filter((metric) => metric.required).map((metric) => metric.key),
      entityIdsInput: "",
      usesLegacyFallback: false,
    };
  }
  const preset = LEGACY_DEFAULTS[kind];
  return {
    basePolicy: {},
    weights: Object.fromEntries(Object.entries(preset.weights).map(([key, value]) => [key, String(value)])),
    metricDefinitions: definitionsForKeys(Object.keys(preset.weights)),
    requiredSignalKeys: [...preset.requiredSignalKeys],
    entityIdsInput: "",
    usesLegacyFallback: true,
  };
}

export function topicVersionPolicyFormFromTemplate(
  raw: unknown,
  fallbackKind: TopicKindValue,
): TopicVersionPolicyForm {
  const basePolicy = recordOf(raw);
  if (!basePolicy) return defaultTopicVersionPolicyForm(fallbackKind);
  const rawWeights = recordOf(basePolicy.weights) ?? {};
  const weights = Object.fromEntries(
    Object.entries(rawWeights).map(([key, value]) => [key, String(value)]),
  );
  const rawDefinitions = Array.isArray(basePolicy.metricDefinitions)
    ? basePolicy.metricDefinitions
    : [];
  const parsedDefinitions = rawDefinitions.flatMap((entry) => {
    const item = recordOf(entry);
    if (!item) return [];
    const key = String(item.key ?? "").trim();
    if (!key || !(key in weights)) return [];
    return [{
      key,
      label: String(item.label ?? key),
      description: String(item.description ?? ""),
      normalizationGuide: String(item.normalizationGuide ?? ""),
      sourceHints: Array.isArray(item.sourceHints) ? item.sourceHints.map(String) : [],
    }];
  });
  const defined = new Set(parsedDefinitions.map((item) => item.key));
  const metricDefinitions = [
    ...parsedDefinitions,
    ...definitionsForKeys(Object.keys(weights).filter((key) => !defined.has(key))),
  ];
  return {
    basePolicy: { ...basePolicy },
    weights,
    metricDefinitions,
    requiredSignalKeys: Array.isArray(basePolicy.requiredSignalKeys)
      ? basePolicy.requiredSignalKeys.map(String)
      : Object.keys(weights),
    entityIdsInput: Array.isArray(basePolicy.entityIds)
      ? basePolicy.entityIds.map(String).join(", ")
      : "",
    usesLegacyFallback: rawDefinitions.length === 0,
  };
}

export type BuildTopicVersionPolicyResult =
  | { ok: true; policyJson: PolicyRecord }
  | { ok: false; message: string };

export function buildTopicVersionPolicy(args: TopicVersionPolicyForm): BuildTopicVersionPolicyResult {
  const entityIds = [
    ...new Set(args.entityIdsInput.split(/[\s,，]+/).map((value) => value.trim()).filter(Boolean)),
  ];
  if (entityIds.length === 0) return { ok: false, message: "请至少填写一个参榜实体编号。" };
  const invalidIds = entityIds.filter((id) => !isDecimalBigIntIdString(id));
  if (invalidIds.length > 0) {
    return {
      ok: false,
      message: `实体编号须为不超过 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位的十进制数字：${invalidIds.join(", ")}`,
    };
  }

  const weights: Record<string, number> = {};
  for (const [key, raw] of Object.entries(args.weights)) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) return { ok: false, message: `指标键 ${key} 不合法。` };
    const value = Number(raw.trim());
    if (!Number.isFinite(value) || value < 0) return { ok: false, message: `${key} 权重必须是大于或等于 0 的数字。` };
    weights[key] = value;
  }
  if (Object.keys(weights).length === 0 || Object.values(weights).every((value) => value === 0)) {
    return { ok: false, message: "至少一个指标权重必须大于 0。" };
  }

  const requiredSignalKeys = [...new Set(args.requiredSignalKeys)];
  const missingWeight = requiredSignalKeys.find((key) => !(key in weights));
  if (missingWeight) return { ok: false, message: `必需指标 ${missingWeight} 没有对应权重。` };

  const metricDefinitions = args.metricDefinitions.filter((item) => item.key in weights);
  return {
    ok: true,
    policyJson: {
      ...args.basePolicy,
      weights,
      entityIds,
      requiredSignalKeys,
      metricDefinitions,
    },
  };
}

export function localDateTimeInputNow(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function localDateTimeInputToIso(raw: string): string | null {
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
