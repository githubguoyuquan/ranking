import { OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED } from '../outbox/outbox.constants';

/** 当前唯一的 Kafka 外发封套版本（与 JSON Schema `event-envelope-v1` 对齐） */
export const KAFKA_ENVELOPE_VERSION = 1 as const;

export type KafkaRoutedEventDefinition = {
  /** 与 OutboxEvent.type 一致 */
  outboxType: string;
  /** 环境变量名，决定目标 topic */
  topicEnvVar: string;
  /** env 未设置或为空时的 topic */
  defaultTopic: string;
  /** `src/kafka/schemas/` 下 payload 校验用文件名 */
  payloadSchemaFile: string;
  /** 事件说明（给运维 / 消费方目录用） */
  description: string;
};

const ROUTED: KafkaRoutedEventDefinition[] = [
  {
    outboxType: OUTBOX_TYPE_RANKING_SNAPSHOT_COMPLETED,
    topicEnvVar: 'KAFKA_TOPIC_RANKING_SNAPSHOT_COMPLETED',
    defaultTopic: 'ranking.snapshot.completed',
    payloadSchemaFile: 'ranking-snapshot-completed-payload-v1.schema.json',
    description:
      'TopicRankSnapshot 物化成功；下游可据此刷新搜索、通知、指标等。',
  },
];

const byType = new Map(ROUTED.map((d) => [d.outboxType, d]));

/** 所有经 Outbox → Kafka 投递的事件定义（扩展新事件时在此注册） */
export function listKafkaRoutedEvents(): readonly KafkaRoutedEventDefinition[] {
  return ROUTED;
}

export function getKafkaRouteForOutboxType(
  type: string,
): KafkaRoutedEventDefinition | undefined {
  return byType.get(type);
}

/** 解析该 outbox 类型对应的 topic 名（未注册到 Kafka 网则返回 null） */
export function resolveKafkaTopicForOutboxType(type: string): string | null {
  const d = byType.get(type);
  if (!d) return null;
  const raw = process.env[d.topicEnvVar]?.trim();
  return raw && raw.length > 0 ? raw : d.defaultTopic;
}

export function buildKafkaEnvelopeV1(args: {
  type: string;
  payload: unknown;
  outboxId: bigint;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    envelopeVersion: KAFKA_ENVELOPE_VERSION,
    type: args.type,
    payload: args.payload,
    meta: {
      outboxId: args.outboxId.toString(),
      createdAt: args.createdAt.toISOString(),
    },
  };
}
