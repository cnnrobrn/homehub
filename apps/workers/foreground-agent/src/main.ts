/**
 * `foreground-agent` worker entrypoint.
 *
 * Hosts the conversation agent loop for `apps/web`'s `/api/chat/stream`.
 * The final deployment target — Vercel Edge vs Railway worker — is
 * deferred to M3.5 (see `specs/13-conversation/agent-loop.md` open
 * questions). For M0 we scaffold as a worker so CI has a buildable
 * service; the same handler file can be imported by an Edge function.
 */

import { createServer } from 'node:http';

import { loadEnv } from '@homehub/shared';
import {
  createLogger,
  createServiceClient,
  initTracing,
  onShutdown,
  runWorker,
  workerRuntimeEnvSchema,
} from '@homehub/worker-runtime';

const SERVICE_NAME = 'worker-foreground-agent';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);

    let ready = false;
    const port = Number.parseInt(process.env.PORT ?? '8080', 10);
    const server = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME }));
        return;
      }
      if (req.url === '/ready') {
        res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: ready ? 'ready' : 'starting', service: SERVICE_NAME }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
    log.info('health server listening', { port });

    onShutdown(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    void supabase;
    ready = true;

    log.info('foreground-agent started (no-op loop)');
    // TODO(@frontend-chat, M3.5): decide edge-vs-worker host and wire
    // the per-turn loop per specs/13-conversation/agent-loop.md.
    await new Promise<void>((resolve) => {
      const onSig = (): void => resolve();
      process.once('SIGTERM', onSig);
      process.once('SIGINT', onSig);
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

process.exit(exitCode);
