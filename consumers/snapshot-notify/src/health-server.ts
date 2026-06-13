import { createServer, type Server } from 'node:http';
import type { SnapshotNotifyHandler } from './handler';

export function startHealthServer(
  port: number,
  getHandler: () => SnapshotNotifyHandler,
): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/health/ready') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'ranking-snapshot-notify' }));
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
