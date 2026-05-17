import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, type Message, type Producer } from 'kafkajs';

@Injectable()
export class KafkaProducerService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private producer: Producer | null = null;
  private connecting: Promise<void> | null = null;

  private brokers(): string[] {
    const raw = process.env.KAFKA_BROKERS ?? '';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  isConfigured(): boolean {
    return this.brokers().length > 0;
  }

  private async ensureProducer(): Promise<Producer | null> {
    const brokers = this.brokers();
    if (brokers.length === 0) return null;
    if (this.producer) return this.producer;
    if (!this.connecting) {
      const kafka = new Kafka({
        clientId: process.env.KAFKA_CLIENT_ID ?? 'ranking-platform',
        brokers,
      });
      this.producer = kafka.producer({
        allowAutoTopicCreation: true,
        retry: { retries: 5 },
      });
      this.connecting = this.producer.connect().finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
    return this.producer;
  }

  /** 未配置 KAFKA_BROKERS 时返回 false（调用方勿标记 outbox 已发） */
  async send(topic: string, messages: Message[]): Promise<boolean> {
    const p = await this.ensureProducer();
    if (!p) return false;
    await p.send({ topic, messages, acks: -1 });
    return true;
  }

  async onModuleDestroy() {
    try {
      await this.producer?.disconnect();
    } catch (e) {
      this.logger.warn(`Kafka disconnect: ${e instanceof Error ? e.message : e}`);
    }
  }
}
