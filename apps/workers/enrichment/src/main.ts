/**
 * `enrichment` worker entrypoint.
 *
 * Composes the runtime (env, Supabase, queue client, tracing, logger,
 * model client) and runs a polling loop across the enrichment-owned
 * queues:
 *
 *   - `enrich_event`         (M3-B) — calendar event → classification,
 *                              episode, fact candidates.
 *   - `enrich_conversation`  (M3.5-B) — member chat turn → fact
 *                              candidates + rules.
 *   - `rollup_conversation`  (M3.5-B) — substantive assistant turn →
 *                              `mem.episode` summarizing the window.
 *   - `embed_node`           (M3.5-B) — populates
 *                              `mem.node.embedding` after create /
 *                              regen.
 *
 * The model client is optional at process boot: when
 * `OPENROUTER_API_KEY` is unset the worker still runs the deterministic
 * classifier path on `enrich_event`, but dead-letters every message on
 * the three model-required queues so operators notice an unusable
 * config.
 *
 * Readiness flips green after a cheap Supabase round-trip against
 * `app.event` confirms the connection; otherwise the /ready probe stays
 * 503 and Railway drains the instance.
 */

import { createServer } from 'node:http';

import { createGoogleMailProvider, type EmailProvider } from '@homehub/providers-email';
import { loadEnv } from '@homehub/shared';
import {
  createGoogleProviderHttpClient,
  createLogger,
  createModelClient,
  createQueueClient,
  createServiceClient,
  initTracing,
  onShutdown,
  runWorker,
  workerRuntimeEnvSchema,
  type ModelClient,
} from '@homehub/worker-runtime';

import { pollOnceConversation } from './conversation-handler.js';
import { pollOnceEmail } from './email-handler.js';
import { pollOnceEmbed } from './embed-handler.js';
import { pollOnce as pollOnceEvent } from './handler.js';
import { pollOnceRollup } from './rollup-handler.js';

const SERVICE_NAME = 'worker-enrichment';

const env = loadEnv(workerRuntimeEnvSchema);
const log = createLogger(env, { service: SERVICE_NAME, component: 'main' });

const IDLE_POLL_DELAY_MS = 2_000;
const ERROR_POLL_DELAY_MS = 5_000;

const exitCode = await runWorker(
  async () => {
    initTracing(env);
    const supabase = createServiceClient(env);
    const queues = createQueueClient(supabase);

    let modelClient: ModelClient | undefined;
    if (env.OPENROUTER_API_KEY) {
      modelClient = createModelClient(env, { logger: log, supabase });
    } else {
      log.warn(
        'OPENROUTER_API_KEY is not set; enrich_event falls back to deterministic classification only. ' +
          'enrich_conversation / enrich_email / rollup_conversation / embed_node messages will be dead-lettered.',
      );
    }

    // Email provider is optional: when Google OAuth env isn't wired the
    // email handler falls back to the stored body_preview (lower quality
    // but functional). Missing Google OAuth does not starve the queue.
    let emailProvider: EmailProvider | undefined;
    try {
      const googleHttp = createGoogleProviderHttpClient({ env, supabase, log });
      emailProvider = createGoogleMailProvider({ nango: googleHttp });
    } catch (err) {
      log.warn(
        'Google OAuth client not constructed; enrich_email will fall back to app.email.body_preview for extraction',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }

    let ready = false;
    let stopping = false;
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
      stopping = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    // Readiness: a cheap head-count against app.event. If this fails
    // we stay un-ready and Railway drains us.
    try {
      const { error } = await supabase
        .schema('app')
        .from('event')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      ready = true;
      log.info('readiness ok; entering poll loop');
    } catch (err) {
      log.error('readiness probe failed; worker will not claim jobs', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Dispatch order matters for fairness: we claim one message per
    // cycle from each queue in turn. If every queue is idle we back
    // off; if any queue had work we loop immediately. This keeps one
    // chatty queue from starving the others.
    while (!stopping) {
      try {
        const outcomes = await Promise.all([
          pollOnceEvent({ supabase, queues, log, ...(modelClient ? { modelClient } : {}) }),
          pollOnceEmail({
            supabase,
            queues,
            log,
            ...(modelClient ? { modelClient } : {}),
            ...(emailProvider ? { emailProvider } : {}),
          }),
          pollOnceConversation({
            supabase,
            queues,
            log,
            ...(modelClient ? { modelClient } : {}),
          }),
          pollOnceRollup({ supabase, queues, log, ...(modelClient ? { modelClient } : {}) }),
          pollOnceEmbed({ supabase, queues, log, ...(modelClient ? { modelClient } : {}) }),
        ]);
        const anyClaimed = outcomes.some((o) => o === 'claimed');
        if (!anyClaimed) {
          await sleep(IDLE_POLL_DELAY_MS, () => stopping);
        }
      } catch (err) {
        log.error('enrichment pollOnce threw', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(ERROR_POLL_DELAY_MS, () => stopping);
      }
    }
    log.info('enrichment main loop exited');
  },
  { shutdownTimeoutMs: 30_000 },
);

async function sleep(ms: number, cancel: () => boolean): Promise<void> {
  const step = 100;
  let remaining = ms;
  while (remaining > 0 && !cancel()) {
    await new Promise((r) => setTimeout(r, Math.min(step, remaining)));
    remaining -= step;
  }
}

process.exit(exitCode);
