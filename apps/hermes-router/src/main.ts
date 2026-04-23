/**
 * hermes-router — Cloud Run service.
 *
 * Endpoints:
 *   GET  /health                     Liveness probe. No auth.
 *   POST /chat/stream                Run one chat turn inside a
 *                                    freshly-spawned Cloud Run Sandbox
 *                                    and stream sandbox stdout back as
 *                                    SSE. Requires HOMEHUB_PROXY_SECRET.
 *   POST /provision/:household_id    Allocate a Supabase Storage
 *                                    state path for a household
 *                                    (idempotent). No sandbox is
 *                                    spawned here; the first chat
 *                                    turn bootstraps state.
 *                                    Requires HOMEHUB_PROVISION_SECRET.
 *   POST /teardown/:household_id     Archive (or hard-delete) the
 *                                    family's state and clear
 *                                    pointers on the household row.
 */

import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { loadEnv } from '@homehub/shared';
import { createLogger, createServiceClient, onShutdown, runWorker } from '@homehub/worker-runtime';

import { routerEnvSchema, type RouterEnv } from './env.js';
import { mintHouseholdJwt } from './jwt.js';
import { runSandboxedTurn } from './sandbox.js';

const SERVICE_NAME = 'hermes-router';

type HouseholdRow = {
  id: string;
  // Storage columns (migration 0016 column names kept for compatibility,
  // but they now reference Supabase Storage bucket + path, not GCS).
  hermes_state_bucket: string | null; // Supabase Storage bucket (default: hermes-state)
  hermes_state_prefix: string | null; // Object path within bucket
  hermes_initialized_at: string | null;
  hermes_archived_at: string | null;
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) return {};
  return JSON.parse(body);
}

function bearerOk(presented: string | undefined, expected: string): boolean {
  if (!presented || !presented.startsWith('Bearer ')) return false;
  const token = presented.slice('Bearer '.length).trim();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function encodeSse(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const HERMES_EVENT_PREFIX = 'HOMEHUB_HERMES_EVENT ';

type HermesHostEvent =
  | { type: 'token'; delta?: unknown }
  | { type: 'thinking'; delta?: unknown }
  | { type: 'thinking_status'; message?: unknown }
  | { type: 'status'; message?: unknown }
  | { type: 'tool_generation'; tool?: unknown }
  | { type: 'error'; message?: unknown; code?: unknown };

function parseHermesHostEvent(line: string): HermesHostEvent | null {
  if (!line.startsWith(HERMES_EVENT_PREFIX)) return null;
  const raw = line.slice(HERMES_EVENT_PREFIX.length);
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new Error('invalid host event');
  }
  return parsed as HermesHostEvent;
}

const env: RouterEnv = loadEnv(routerEnvSchema);
const log = createLogger({ LOG_LEVEL: 'info' } as never, {
  service: SERVICE_NAME,
  component: 'main',
});
const supabase = createServiceClient({
  SUPABASE_URL: env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
} as never);

const exitCode = await runWorker(
  async () => {
    const server = createServer(async (req, res) => {
      const startedAt = Date.now();
      try {
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME }));
          return;
        }
        if (req.method === 'POST' && req.url === '/chat/stream') {
          await handleChatStream(req, res);
          log.info('chat.stream', { duration_ms: Date.now() - startedAt });
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/provision/')) {
          await handleProvision(req, res);
          return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/teardown/')) {
          await handleTeardown(req, res);
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'internal error';
        log.error('handler.crash', { url: req.url, message });
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal_error', message }));
        } else {
          res.end();
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.PORT, () => {
        server.off('error', reject);
        resolve();
      });
    });
    log.info('listening', { port: env.PORT });

    onShutdown(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    await new Promise<void>((resolve) => {
      process.once('SIGTERM', () => resolve());
      process.once('SIGINT', () => resolve());
    });
  },
  { shutdownTimeoutMs: 30_000 },
);

async function loadHouseholdRow(id: string): Promise<HouseholdRow | null> {
  const { data } = await supabase
    .schema('app')
    .from('household')
    .select(
      'id, hermes_state_bucket, hermes_state_prefix, hermes_initialized_at, hermes_archived_at',
    )
    .eq('id', id)
    .maybeSingle<HouseholdRow>();
  return data ?? null;
}

async function ensureStatePointer(householdId: string): Promise<{ bucket: string; path: string }> {
  const row = await loadHouseholdRow(householdId);
  if (!row) throw new Error(`household ${householdId} not found`);
  if (row.hermes_archived_at) {
    throw new Error(`household ${householdId} is archived — restore before use`);
  }
  if (row.hermes_state_bucket && row.hermes_state_prefix) {
    return { bucket: row.hermes_state_bucket, path: row.hermes_state_prefix };
  }
  // Path layout: `<household_id>/state.tar.gz`. The first segment MUST
  // be the household_id UUID — RLS (migration 0017) enforces this by
  // comparing split_part(name,'/',1) to the JWT's household_id claim.
  const bucket = env.HERMES_STORAGE_BUCKET;
  const path = `${householdId}/state.tar.gz`;
  const { error } = await supabase
    .schema('app')
    .from('household')
    .update({
      hermes_state_bucket: bucket,
      hermes_state_prefix: path,
    } as never)
    .eq('id', householdId);
  if (error) throw new Error(`db update failed: ${error.message}`);
  log.info('state.pointer_allocated', { household_id: householdId, bucket, path });
  return { bucket, path };
}

async function handleChatStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!bearerOk(req.headers['authorization'] as string | undefined, env.HOMEHUB_PROXY_SECRET)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const body = (await readJson(req)) as {
    household_id?: string;
    member_id?: string;
    member_role?: string;
    user_id?: string;
    conversation_id?: string;
    turn_id?: string;
    message?: string;
  };
  if (
    !body.household_id ||
    !body.member_id ||
    !body.user_id ||
    !body.conversation_id ||
    !body.turn_id ||
    !body.message
  ) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing_fields' }));
    return;
  }

  // Allocate the Storage pointer on first chat if provision didn't run.
  // This is the "pre-provision failed, heal on first use" path.
  const ptr = await ensureStatePointer(body.household_id);

  // Mint a short-lived household-scoped JWT for this turn. The sandbox
  // uses it instead of the service-role key; RLS enforces the scope.
  const supabaseJwt = mintHouseholdJwt({
    userId: body.user_id,
    householdId: body.household_id,
    memberId: body.member_id,
    jwtSecret: env.HOMEHUB_SUPABASE_JWT_SECRET,
    ttlSeconds: env.HERMES_JWT_TTL_SECONDS,
  });

  const { stream, wait } = await runSandboxedTurn(env, {
    storageBucket: ptr.bucket,
    storagePath: ptr.path,
    turn: {
      householdId: body.household_id,
      conversationId: body.conversation_id,
      turnId: body.turn_id,
      memberId: body.member_id,
      memberRole: body.member_role ?? 'adult',
      message: body.message,
      supabaseJwt,
    },
  });

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(
    encodeSse({ type: 'start', turnId: body.turn_id, conversationId: body.conversation_id }),
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let assistantBody = '';
  let exitCode = -1;
  let hostBuffer = '';
  const emitToken = (delta: string) => {
    if (!delta) return;
    assistantBody += delta;
    res.write(encodeSse({ type: 'token', delta }));
  };
  const forwardHostEvent = (event: HermesHostEvent) => {
    switch (event.type) {
      case 'token': {
        if (typeof event.delta === 'string') emitToken(event.delta);
        return;
      }
      case 'thinking': {
        if (typeof event.delta === 'string') {
          res.write(encodeSse({ type: 'thinking', delta: event.delta }));
        }
        return;
      }
      case 'thinking_status': {
        if (typeof event.message === 'string') {
          res.write(encodeSse({ type: 'thinking_status', message: event.message }));
        }
        return;
      }
      case 'status': {
        if (typeof event.message === 'string') {
          res.write(encodeSse({ type: 'status', message: event.message }));
        }
        return;
      }
      case 'tool_generation': {
        if (typeof event.tool === 'string') {
          res.write(encodeSse({ type: 'tool_generation', tool: event.tool }));
        }
        return;
      }
      case 'error': {
        res.write(
          encodeSse({
            type: 'error',
            message: typeof event.message === 'string' ? event.message : 'Hermes host error',
            code: typeof event.code === 'string' ? event.code : 'hermes_host_error',
          }),
        );
        return;
      }
    }
  };
  const consumeHostText = (text: string, flush = false) => {
    hostBuffer += text;
    let newlineIndex: number;
    while ((newlineIndex = hostBuffer.indexOf('\n')) !== -1) {
      const line = hostBuffer.slice(0, newlineIndex);
      hostBuffer = hostBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        const event = parseHermesHostEvent(line);
        if (event) {
          forwardHostEvent(event);
        } else {
          emitToken(`${line}\n`);
        }
      } catch (err) {
        log.warn('host.event_parse_failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        res.write(
          encodeSse({
            type: 'error',
            message: 'failed to parse Hermes host event',
            code: 'hermes_event_parse_failed',
          }),
        );
      }
    }
    if (flush && hostBuffer) {
      try {
        const event = parseHermesHostEvent(hostBuffer);
        if (event) {
          forwardHostEvent(event);
        } else {
          emitToken(hostBuffer);
        }
      } catch {
        emitToken(hostBuffer);
      } finally {
        hostBuffer = '';
      }
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const delta = decoder.decode(value, { stream: true });
      if (!delta) continue;
      consumeHostText(delta);
    }
    const tail = decoder.decode();
    if (tail) {
      consumeHostText(tail);
    }
    consumeHostText('', true);
    exitCode = await wait();
    if (exitCode !== 0) {
      res.write(
        encodeSse({
          type: 'error',
          message: `Hermes exited with code ${exitCode}`,
          code: 'hermes_exit',
        }),
      );
      return;
    }

    const { data: assistantTurn, error: assistantErr } = await supabase
      .schema('app')
      .from('conversation_turn')
      .insert({
        conversation_id: body.conversation_id,
        household_id: body.household_id,
        role: 'assistant',
        body_md: assistantBody || '(no response)',
        model: env.HERMES_DEFAULT_MODEL,
        input_tokens: null,
        output_tokens: null,
        cost_cents: null,
        tool_calls: [],
        citations: [],
      } as never)
      .select('id')
      .single<{ id: string }>();
    if (assistantErr) {
      log.error('assistant_turn.insert_failed', {
        household_id: body.household_id,
        conversation_id: body.conversation_id,
        message: assistantErr.message,
      });
      res.write(
        encodeSse({
          type: 'error',
          message: 'assistant turn persistence failed',
          code: 'assistant_persist_failed',
        }),
      );
      return;
    }

    await supabase
      .schema('app')
      .from('conversation')
      .update({ last_message_at: new Date().toISOString() } as never)
      .eq('id', body.conversation_id)
      .eq('household_id', body.household_id);

    res.write(
      encodeSse({
        type: 'final',
        turnId: assistantTurn.id,
        conversationId: body.conversation_id,
        assistantBody,
        toolCalls: [],
        citations: [],
        model: env.HERMES_DEFAULT_MODEL,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Hermes stream failed';
    log.error('sandbox.stream_failed', { household_id: body.household_id, message });
    res.write(encodeSse({ type: 'error', message, code: 'sandbox_stream_failed' }));
  } finally {
    if (exitCode === -1) exitCode = await wait().catch(() => -1);
    log.info('sandbox.exit', { household_id: body.household_id, code: exitCode });
    res.end();
  }
}

async function handleProvision(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!bearerOk(req.headers['authorization'] as string | undefined, env.HOMEHUB_PROVISION_SECRET)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const householdId = req.url?.replace('/provision/', '');
  if (!householdId) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing_household_id' }));
    return;
  }

  try {
    const ptr = await ensureStatePointer(householdId);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'provisioned',
        bucket: ptr.bucket,
        path: ptr.path,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('provision.failed', { household_id: householdId, message });
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'provision_failed', message }));
  }
}

async function handleTeardown(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!bearerOk(req.headers['authorization'] as string | undefined, env.HOMEHUB_PROVISION_SECRET)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const householdId = req.url?.replace('/teardown/', '');
  if (!householdId) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing_household_id' }));
    return;
  }

  // Archive, don't hard-delete. We mark `hermes_archived_at` and
  // preserve the bucket/path pointer. The family's memories, sessions,
  // and overlays stay in Supabase Storage for the retention window
  // (default 30 days) so an accidental delete is recoverable. A
  // daily cleanup job scans for `hermes_archived_at < now() - 30d`
  // and hard-deletes. Callers who really want immediate destruction
  // pass `?hard=1` and sign a separate confirmation.
  const url = new URL(req.url ?? '', 'http://local');
  const hard = url.searchParams.get('hard') === '1';
  const update: Record<string, unknown> = hard
    ? {
        hermes_state_bucket: null,
        hermes_state_prefix: null,
        hermes_initialized_at: null,
        hermes_archived_at: null,
      }
    : { hermes_archived_at: new Date().toISOString() };

  const { error } = await supabase
    .schema('app')
    .from('household')
    .update(update as never)
    .eq('id', householdId);
  if (error) {
    log.error('teardown.db_update_failed', { household_id: householdId, message: error.message });
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'db_update_failed', message: error.message }));
    return;
  }
  log.info(hard ? 'teardown.hard' : 'teardown.archived', { household_id: householdId });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: hard ? 'torn_down' : 'archived' }));
}

process.exit(exitCode);
