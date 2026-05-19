/** 与 Prisma `TopicKind` 及 `src/domain/topic-kind-policy.ts` 预设一致 */
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
    hint: "偏 streams / mentions；衰减半衰期 14 天",
  },
  {
    value: "SEMI_OBJECTIVE",
    label: "半客观榜",
    hint: "默认演示权重；半衰期 10 天",
  },
  {
    value: "SUBJECTIVE_TREND",
    label: "主观趋势榜",
    hint: "偏 mentions / social；半衰期 5 天",
  },
];

export function isTopicKindValue(v: string): v is TopicKindValue {
  return (TOPIC_KIND_VALUES as readonly string[]).includes(v);
}
