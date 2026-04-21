/**
 * Unit tests for the pgmq wrapper. We mock the Supabase RPC / insert
 * surface; there's no live Postgres involved.
 */

import { describe, expect, it, vi } from 'vitest';

import { QueueError } from '../errors.js';
import { type ServiceSupabaseClient } from '../supabase/client.js';

import { createQueueClient } from './client.js';
import { type MessageEnvelope } from './envelope.js';

function envelope(): MessageEnvelope {
  return {
    household_id: '11111111-1111-4111-8111-111111111111',
    kind: 'test.message',
    entity_id: '22222222-2222-4222-8222-222222222222',
    version: 1,
    enqueued_at: '2026-04-20T00:00:00.000Z',
  };
}

describe('deadLetter', () => {
  it('inserts a row into sync.dead_letter with the full payload and reason', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const schema = vi.fn().mockReturnValue({ from });
    const supabase = { schema } as unknown as ServiceSupabaseClient;

    const client = createQueueClient(supabase);
    const env = envelope();
    await client.deadLetter('q.test', 42, 'bad payload', env);

    expect(schema).toHaveBeenCalledWith('sync');
    expect(from).toHaveBeenCalledWith('dead_letter');
    expect(insert).toHaveBeenCalledWith({
      queue: 'q.test',
      message_id: 42,
      payload: env,
      error: 'bad payload',
    });
  });

  it('wraps an insert error in QueueError', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom', code: 'XX000' } });
    const supabase = {
      schema: () => ({ from: () => ({ insert }) }),
    } as unknown as ServiceSupabaseClient;
    const client = createQueueClient(supabase);
    await expect(client.deadLetter('q.test', 1, 'x', envelope())).rejects.toBeInstanceOf(
      QueueError,
    );
  });
});
