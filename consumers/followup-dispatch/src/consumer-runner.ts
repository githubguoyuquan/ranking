import { Kafka, logLevel } from 'kafkajs';
import type { ConsumerConfig } from './config';
import { FollowupDispatchHandler, OutboxIdLedger } from './handler';
import { parseRankingFollowupRequestedMessage } from './validate-envelope';

export async function runConsumer(
  config: ConsumerConfig,
  handler: FollowupDispatchHandler,
): Promise<{ stop: () => Promise<void> }> {
  const kafka = new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    logLevel: logLevel.WARN,
  });

  const consumer = kafka.consumer({ groupId: config.groupId });
  await consumer.connect();
  await consumer.subscribe({
    topic: config.topic,
    fromBeginning: config.fromBeginning,
  });

  await consumer.run({
    autoCommit: true,
    eachMessage: async ({ message, partition, topic }) => {
      const raw = message.value?.toString('utf8');
      if (!raw) {
        handler.recordInvalid();
        console.warn(JSON.stringify({ level: 'warn', msg: 'empty_message', topic, partition }));
        return;
      }

      const parsed = parseRankingFollowupRequestedMessage(raw);
      if (!parsed.ok) {
        handler.recordInvalid();
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'invalid_message',
            reason: parsed.reason,
            topic,
            partition,
            offset: message.offset,
          }),
        );
        return;
      }

      try {
        await handler.handle(parsed.envelope);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'handle_failed',
            outboxId: parsed.envelope.meta.outboxId,
            snapshotId: parsed.envelope.payload.snapshotId,
            error: err,
          }),
        );
        throw e;
      }
    },
  });

  return {
    stop: async () => {
      await consumer.disconnect();
    },
  };
}

export function createHandler(config: ConsumerConfig): FollowupDispatchHandler {
  return new FollowupDispatchHandler(
    new OutboxIdLedger(config.ledgerPath),
    config.dispatchUrl,
    config.dispatchApiKey,
  );
}
