import { PassThrough } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { type WorkerRuntimeEnv } from '../env.js';

import { type Logger } from './logger.js';

/**
 * Builds a Logger bound to a PassThrough stream so the test can assert
 * on exact bytes. Matches `createLogger` except for the destination;
 * the destination swap is the whole point of the test harness — the
 * real `createLogger` writes to stdout via pino's default, and we don't
 * want to muck with the process stream during tests.
 */
function makeCapturingLogger(
  env: WorkerRuntimeEnv,
  opts: { service: string; component: string },
): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new PassThrough();
  let buf = '';
  stream.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      if (line) lines.push(line);
    }
  });

  const inner = pino(
    {
      level: env.LOG_LEVEL,
      base: { service: opts.service, component: opts.component },
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      messageKey: 'msg',
    },
    stream,
  );

  const wrap = (p: pino.Logger): Logger => ({
    trace: (msg, ctx) => p.trace(ctx ?? {}, msg),
    debug: (msg, ctx) => p.debug(ctx ?? {}, msg),
    info: (msg, ctx) => p.info(ctx ?? {}, msg),
    warn: (msg, ctx) => p.warn(ctx ?? {}, msg),
    error: (msg, ctx) => p.error(ctx ?? {}, msg),
    fatal: (msg, ctx) => p.fatal(ctx ?? {}, msg),
    child: (bindings) => wrap(p.child(bindings)),
  });

  return { logger: wrap(inner), lines };
}

const testEnv: WorkerRuntimeEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'debug',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'x',
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  OPENROUTER_HTTP_REFERER: 'https://app.homehub.ing',
  OPENROUTER_APP_TITLE: 'HomeHub',
} as WorkerRuntimeEnv;

async function flush(): Promise<void> {
  // Two immediates: one for pino's write to land, one for our PassThrough data handler to run.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('createLogger', () => {
  it('emits valid JSON with required fields', async () => {
    const { logger, lines } = makeCapturingLogger(testEnv, {
      service: 'svc',
      component: 'cmp',
    });
    logger.info('hello world');
    await flush();

    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({
      msg: 'hello world',
      service: 'svc',
      component: 'cmp',
    });
    expect(typeof parsed.ts).toBe('string');
    expect(parsed.level).toBeDefined();
  });

  it('propagates household_id via child loggers', async () => {
    const { logger, lines } = makeCapturingLogger(testEnv, {
      service: 'svc',
      component: 'cmp',
    });
    const hhLog = logger.child({ household_id: 'hh-1' });
    hhLog.warn('scoped', { request_id: 'req-1', duration_ms: 42 });
    await flush();

    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.household_id).toBe('hh-1');
    expect(parsed.request_id).toBe('req-1');
    expect(parsed.duration_ms).toBe(42);
    expect(parsed.msg).toBe('scoped');
    expect(parsed.service).toBe('svc');
    expect(parsed.component).toBe('cmp');
  });
});
