import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

process.env.PROCESS_ROLE = 'worker';

/**
 * 平台 Worker：BullMQ（排行 / follow-up / ai-agent）、Outbox→Kafka、CH/ES Flusher。
 */
async function bootstrap() {
  const { AppModule } = await import('./app.module');
  const logger = new Logger('PlatformWorker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  logger.log(
    'Platform worker online — ranking / follow-up / ai-agent queues + outbox Kafka + CH/ES flushers',
  );
  const shutdown = async () => {
    logger.warn('shutting down platform worker...');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();
