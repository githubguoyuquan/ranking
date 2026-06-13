import 'dotenv/config';

import { loadConfig } from './config';
import { createHandler, runConsumer } from './consumer-runner';
import { startHealthServer } from './health-server';

async function main() {
  const config = loadConfig();
  const handler = createHandler(config);

  const http = startHealthServer(config.httpPort, () => handler);
  const { stop } = await runConsumer(config, handler);

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'consumer_started',
      topic: config.topic,
      groupId: config.groupId,
      brokers: config.brokers,
      httpPort: config.httpPort,
      webhook: Boolean(config.webhookUrl),
    }),
  );

  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ level: 'info', msg: 'shutting_down', signal }));
    http.close();
    await stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
