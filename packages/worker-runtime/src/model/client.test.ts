/**
 * Tests for `createModelClient`'s model_calls recorder path.
 *
 * The recorder runs fire-and-forget after a successful OpenRouter call.
 * We stub the OpenRouter fetch + the Supabase insert, then assert the
 * row shape and the recorder's tolerance of DB errors.
 */

import { type HouseholdId } from '@homehub/shared';
import { describe, expect, it, vi } from 'vitest';

import { type WorkerRuntimeEnv } from '../env.js';
import { type Logger } from '../log/logger.js';
import { type ServiceSupabaseClient } from '../supabase/client.js';

import { createModelClient } from './client.js';

function fakeEnv(): WorkerRuntimeEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
    OPENROUTER_API_KEY: 'or-test',
    OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
    OPENROUTER_HTTP_REFERER: 'https://homehub.app',
    OPENROUTER_APP_TITLE: 'HomeHub',
  } as WorkerRuntimeEnv;
}

function fakeLogger(): {
  logger: Logger;
  warns: unknown[][];
  infos: unknown[][];
} {
  const warns: unknown[][] = [];
  const infos: unknown[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logger: any = {
    trace: () => {},
    debug: () => {},
    info: (...a: unknown[]) => infos.push(a),
    warn: (...a: unknown[]) => warns.push(a),
    error: () => {},
    fatal: () => {},
    child: () => logger,
  };
  return { logger, warns, infos };
}

function fakeOpenRouterResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'r-1',
      model: 'anthropic/claude-sonnet-4',
      choices: [{ message: { content: 'hello', role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.003 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('model client — model_calls recorder', () => {
  it('inserts a row into app.model_calls with the expected shape', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      schema: () => ({ from: () => ({ insert }) }),
    } as unknown as ServiceSupabaseClient;

    const { logger } = fakeLogger();
    const fetchImpl = vi.fn().mockResolvedValue(fakeOpenRouterResponse());

    const client = createModelClient(fakeEnv(), { logger, supabase, fetchImpl });
    await client.generate({
      task: 'enrichment.event',
      household_id: '11111111-1111-4111-8111-111111111111' as HouseholdId,
      systemPrompt: 's',
      userPrompt: 'u',
    });

    // Recorder is fire-and-forget; let microtasks drain.
    await new Promise((r) => setImmediate(r));
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0]![0];
    expect(row.household_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(row.task).toBe('enrichment.event');
    expect(row.input_tokens).toBe(10);
    expect(row.output_tokens).toBe(2);
    expect(row.cost_usd).toBe(0.003);
    expect(typeof row.latency_ms).toBe('number');
    expect(typeof row.at).toBe('string');
  });

  it('warns but does not throw when the insert fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'pg boom', code: 'XX000' } });
    const supabase = {
      schema: () => ({ from: () => ({ insert }) }),
    } as unknown as ServiceSupabaseClient;

    const { logger, warns } = fakeLogger();
    const fetchImpl = vi.fn().mockResolvedValue(fakeOpenRouterResponse());

    const client = createModelClient(fakeEnv(), { logger, supabase, fetchImpl });
    const res = await client.generate({
      task: 't',
      household_id: '11111111-1111-4111-8111-111111111111' as HouseholdId,
      systemPrompt: 's',
      userPrompt: 'u',
    });
    await new Promise((r) => setImmediate(r));
    expect(res.text).toBe('hello');
    expect(warns.some((a) => String(a[0]).includes('model_calls insert failed'))).toBe(true);
  });
});
