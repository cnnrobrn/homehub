/**
 * Unit tests for the worker heartbeat helpers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordWorkerHeartbeat, startHeartbeatLoop } from './heartbeat.js';

interface UpsertCall {
  table: string;
  payload: Record<string, unknown>;
  opts: { onConflict: string };
}

function stubClient(error: { message: string } | null = null) {
  const calls: UpsertCall[] = [];
  const client = {
    schema(_name: string) {
      return {
        from(table: string) {
          return {
            upsert(payload: Record<string, unknown>, opts: { onConflict: string }) {
              calls.push({ table, payload, opts });
              return Promise.resolve({ error });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('recordWorkerHeartbeat', () => {
  it('upserts on (service, component) into sync.worker_heartbeat', async () => {
    const { client, calls } = stubClient();
    const ok = await recordWorkerHeartbeat({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      service: 'worker-reflector',
      component: 'main',
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe('worker_heartbeat');
    expect(calls[0]?.opts.onConflict).toBe('service,component');
    expect(calls[0]?.payload).toMatchObject({
      service: 'worker-reflector',
      component: 'main',
    });
    expect(typeof calls[0]?.payload.last_seen_at).toBe('string');
  });

  it('returns false when the table is unavailable (pending migration)', async () => {
    const { client } = stubClient({ message: 'relation "sync.worker_heartbeat" does not exist' });
    const ok = await recordWorkerHeartbeat({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      service: 's',
      component: 'c',
    });
    expect(ok).toBe(false);
  });
});

describe('startHeartbeatLoop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires an initial beat and repeats on the interval', async () => {
    vi.useFakeTimers();
    const { client, calls } = stubClient();
    const handle = startHeartbeatLoop({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      service: 's',
      component: 'c',
      intervalMs: 1_000,
    });
    // The initial call is fire-and-forget; flush microtasks so the
    // stubbed upsert runs.
    await Promise.resolve();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(1_050);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    handle.stop();
  });
});
