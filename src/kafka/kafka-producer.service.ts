import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kafka, type Message, type Producer, logLevel } from 'kafkajs';

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

  private kafkaLogLevel(): logLevel {
    const v = process.env.KAFKAJS_LOG_LEVEL?.toUpperCase();
    if (v === 'DEBUG') return logLevel.DEBUG;
    if (v === 'INFO') return logLevel.INFO;
    if (v === 'WARN') return logLevel.WARN;
    if (v === 'ERROR') return logLevel.ERROR;
    if (v === 'NOTHING') return logLevel.NOTHING;
    /** 默认静默，避免 broker 未启动时刷屏；排查时可设 KAFKAJS_LOG_LEVEL=WARN */
    return logLevel.NOTHING;
  }

  private async resetProducer(): Promise<void> {
    const p = this.producer;
    this.producer = null;
    this.connecting = null;
    if (!p) return;
    try {
      await p.disconnect();
    } catch {
      /* ignore */
    }
  }

  private async ensureProducer(): Promise<Producer | null> {
    const brokers = this.brokers();
    if (brokers.length === 0) return null;

    if (this.producer) return this.producer;

    if (!this.connecting) {
      const kafka = new Kafka({
        clientId: process.env.KAFKA_CLIENT_ID ?? 'ranking-platform',
        brokers,
        logLevel: this.kafkaLogLevel(),
      });
      const producer = kafka.producer({
        allowAutoTopicCreation: true,
        retry: { retries: 5 },
      });
      this.connecting = producer
        .connect()
        .then(() => {
          this.producer = producer;
        })
        .catch(async (err) => {
          try {
            await producer.disconnect();
          } catch {
            /* ignore */
          }
          this.producer = null;
          throw err;
        })
        .finally(() => {
          this.connecting = null;
        });
    }

    try {
      await this.connecting;
    } catch {
      return null;
    }
    return this.producer;
  }

  /**
   * 未配置 KAFKA_BROKERS 时返回 false。
   * 发送失败会复位 producer，便于下一轮重连。
   */
  async send(topic: string, messages: Message[]): Promise<boolean> {
    try {
      const p = await this.ensureProducer();
      if (!p) return false;
      await p.send({ topic, messages, acks: -1 });
      return true;
    } catch (e) {
      await this.resetProducer();
      throw e;
    }
  }

  async onModuleDestroy() {
    await this.resetProducer();
  }
}
