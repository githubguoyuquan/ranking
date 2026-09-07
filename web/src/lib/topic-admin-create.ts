import {
  DECIMAL_BIGINT_ID_MAX_DIGITS,
  isDecimalBigIntIdString,
} from "./decimal-id";
import type { TopicKindValue } from "./topic-kind";

export const TOPIC_POLICY_METRIC_KEYS = [
  "streams",
  "mentions",
  "social",
  "news",
] as const;

export type TopicPolicyMetricKey = (typeof TOPIC_POLICY_METRIC_KEYS)[number];
export type TopicPolicyWeightInputs = Record<TopicPolicyMetricKey, string>;

type PolicyRecord = Record<string, unknown>;

const DEFAULTS: Record<
  TopicKindValue,
  { weights: Record<TopicPolicyMetricKey, number>; requiredSignalKeys: string[] }
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

export type TopicVersionPolicyForm = {
  basePolicy: PolicyRecord;
  weights: TopicPolicyWeightInputs;
  requiredSignalKeys: string[];
  entityIdsInput: string;
};

export function defaultTopicVersionPolicyForm(
  kind: TopicKindValue,
): TopicVersionPolicyForm {
  const preset = DEFAULTS[kind];
  return {
    basePolicy: {},
    weights: Object.fromEntries(
      TOPIC_POLICY_METRIC_KEYS.map((key) => [key, String(preset.weights[key])]),
    ) as TopicPolicyWeightInputs,
    requiredSignalKeys: [...preset.requiredSignalKeys],
    entityIdsInput: "",
  };
}

export function topicVersionPolicyFormFromTemplate(
  raw: unknown,
  fallbackKind: TopicKindValue,
): TopicVersionPolicyForm {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultTopicVersionPolicyForm(fallbackKind);
  }
  const basePolicy = { ...(raw as PolicyRecord) };
  const defaults = defaultTopicVersionPolicyForm(fallbackKind);
  const rawWeights =
    basePolicy.weights !== null &&
    typeof basePolicy.weights === "object" &&
    !Array.isArray(basePolicy.weights)
      ? (basePolicy.weights as Record<string, unknown>)
      : {};
  const weights = { ...defaults.weights };
  for (const key of TOPIC_POLICY_METRIC_KEYS) {
    if (rawWeights[key] != null) weights[key] = String(rawWeights[key]);
  }
  return {
    basePolicy,
    weights,
    requiredSignalKeys: Array.isArray(basePolicy.requiredSignalKeys)
      ? basePolicy.requiredSignalKeys.map(String)
      : defaults.requiredSignalKeys,
    entityIdsInput: Array.isArray(basePolicy.entityIds)
      ? basePolicy.entityIds.map(String).join(", ")
      : "",
  };
}

export type BuildTopicVersionPolicyResult =
  | { ok: true; policyJson: PolicyRecord }
  | { ok: false; message: string };

export function buildTopicVersionPolicy(args: {
  basePolicy: PolicyRecord;
  weights: TopicPolicyWeightInputs;
  requiredSignalKeys: string[];
  entityIdsInput: string;
}): BuildTopicVersionPolicyResult {
  const entityIds = [
    ...new Set(
      args.entityIdsInput
        .split(/[\s,，]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (entityIds.length === 0) {
    return { ok: false, message: "请至少填写一个参榜实体编号。" };
  }
  const invalidIds = entityIds.filter((id) => !isDecimalBigIntIdString(id));
  if (invalidIds.length > 0) {
    return {
      ok: false,
      message: `实体编号须为不超过 ${DECIMAL_BIGINT_ID_MAX_DIGITS} 位的十进制数字：${invalidIds.join(", ")}`,
    };
  }

  const previousWeights =
    args.basePolicy.weights !== null &&
    typeof args.basePolicy.weights === "object" &&
    !Array.isArray(args.basePolicy.weights)
      ? { ...(args.basePolicy.weights as Record<string, unknown>) }
      : {};
  for (const key of TOPIC_POLICY_METRIC_KEYS) {
    const value = Number(args.weights[key].trim());
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, message: `${key} 权重必须是大于或等于 0 的数字。` };
    }
    previousWeights[key] = value;
  }
  if (
    Object.values(previousWeights).every(
      (value) => typeof value !== "number" || value === 0,
    )
  ) {
    return { ok: false, message: "至少一个指标权重必须大于 0。" };
  }

  const requiredSignalKeys = [...new Set(args.requiredSignalKeys)];
  const missingWeight = requiredSignalKeys.find(
    (key) => !(key in previousWeights),
  );
  if (missingWeight) {
    return {
      ok: false,
      message: `必需指标 ${missingWeight} 没有对应权重。`,
    };
  }

  return {
    ok: true,
    policyJson: {
      ...args.basePolicy,
      weights: previousWeights,
      entityIds,
      requiredSignalKeys,
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
