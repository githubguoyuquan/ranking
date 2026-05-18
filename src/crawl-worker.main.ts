import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './worker-app.module';

async function bootstrap() {
  const logger = new Logger('CrawlWorker');
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    logger: ['error', 'warn', 'log'],
  });
  logger.log(
    'Crawl worker online — BullMQ consumers on queue `crawl` (shared Redis with API)',
  );
  const shutdown = async () => {
    logger.warn('shutting down crawl worker...');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();
