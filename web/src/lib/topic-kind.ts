/** 与 Prisma `TopicKind` 一致；类型只影响证据风格和时间衰减，不再绑定固定指标。 */
export const TOPIC_KIND_VALUES = [
  "OBJECTIVE",
  "SEMI_OBJECTIVE",
  "SUBJECTIVE_TREND",
] as const;

export type TopicKindValue = (typeof TOPIC_KIND_VALUES)[number];

export const TOPIC_KIND_OPTIONS: Array<{
  value: TopicKindValue;
  label: string;
  hint: string;
}> = [
  {
    value: "OBJECTIVE",
    label: "客观榜",
    hint: "优先可复核的直接数据；半衰期 14 天",
  },
  {
    value: "SEMI_OBJECTIVE",
    label: "半客观榜",
    hint: "允许多类证据互相补充；半衰期 10 天",
  },
  {
    value: "SUBJECTIVE_TREND",
    label: "主观趋势榜",
    hint: "强调近期变化；半衰期 5 天",
  },
];

export function isTopicKindValue(v: string): v is TopicKindValue {
  return (TOPIC_KIND_VALUES as readonly string[]).includes(v);
}
