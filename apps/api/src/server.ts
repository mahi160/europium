import { serve } from '@hono/node-server';
import { createApp } from './app';
import { envConfig } from './config';
import { z } from 'zod';

try {
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env.PORT ?? 3000);
  const backend = createApp(envConfig());
  const server = serve({ fetch: backend.app.fetch, port });
  const timer = setInterval(() => {
    void backend.push.tick().catch(() => {
      process.stderr.write('Push scheduling failed\n');
    });
  }, 1000);
  void backend.push.tick().catch(() => {
    process.stderr.write('Push scheduling failed\n');
  });
  const shutdown = () => {
    clearInterval(timer);
    backend.push.stop();
    void backend.push
      .drain()
      .catch(() => {})
      .finally(() => {
        backend.close();
        server.close();
      });
  };
  server.on('error', () => {
    process.stderr.write('Backend server failed\n');
    shutdown();
    process.exitCode = 1;
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  process.stderr.write(
    'Backend startup failed. Check protected configuration and storage; pending production migrations require sh scripts/upgrade.sh. Do not delete volumes. See docs/backups.md.\n',
  );
  process.exitCode = 1;
}
