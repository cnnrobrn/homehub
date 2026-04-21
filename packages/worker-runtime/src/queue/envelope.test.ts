import { describe, expect, it } from 'vitest';

import { messageEnvelopeSchema } from './envelope.js';

describe('messageEnvelopeSchema', () => {
  const valid = {
    household_id: '11111111-1111-4111-8111-111111111111',
    kind: 'enrich_event',
    entity_id: '22222222-2222-4222-8222-222222222222',
    version: 1,
    enqueued_at: '2026-04-20T12:00:00.000Z',
  };

  it('accepts a well-formed envelope', () => {
    const result = messageEnvelopeSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID household_id', () => {
    const result = messageEnvelopeSchema.safeParse({ ...valid, household_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects empty kind', () => {
    const result = messageEnvelopeSchema.safeParse({ ...valid, kind: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative version', () => {
    const result = messageEnvelopeSchema.safeParse({ ...valid, version: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-ISO enqueued_at', () => {
    const result = messageEnvelopeSchema.safeParse({ ...valid, enqueued_at: 'yesterday' });
    expect(result.success).toBe(false);
  });

  it('rejects missing required keys', () => {
    const { household_id: _omit, ...partial } = valid;
    const result = messageEnvelopeSchema.safeParse(partial);
    expect(result.success).toBe(false);
  });
});
