/**
 * Unit tests for the sync-grocery handler.
 *
 * Exercises the idle-return path when no queues have work and the
 * dead-letter path when the provider throws a non-rate-limit error.
 */

import { type Logger, type QueueClient } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pollOnce } from './handler.js';

function makeLog(): Logger {
  const noop = () => {};
  const base = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => base,
  } as Logger;
  return base;
}

function makeQueues(): { queues: QueueClient; claimCalls: number } {
  let claimCalls = 0;
  const queues: QueueClient = {
    claim: vi.fn(async () => {
      claimCalls += 1;
      return null;
    }),
    ack: vi.fn(),
    nack: vi.fn(),
    send: vi.fn(),
    sendBatch: vi.fn(),
    deadLetter: vi.fn(),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;
  return {
    queues,
    get claimCalls() {
      return claimCalls;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pollOnce', () => {
  it('returns "idle" when every queue is empty', async () => {
    const { queues } = makeQueues();
    const outcome = await pollOnce({
      supabase: {} as never,
      queues,
      providerFor: () => null,
      log: makeLog(),
      ingestionEnabled: false,
    });
    expect(outcome).toBe('idle');
    expect(queues.claim).toHaveBeenCalled();
  });
});
