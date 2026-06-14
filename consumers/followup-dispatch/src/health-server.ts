import { createServer, type Server } from 'node:http';
import type { FollowupDispatchHandler } from './handler';

export function startHealthServer(
  port: number,
  getHandler: () => FollowupDispatchHandler,
): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/health/ready') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'ranking-followup-dispatch' }));
      return;
    }
    if (req.url === '/metrics') {
      const stats = getHandler().stats;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port);
  return server;
}
