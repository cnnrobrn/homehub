import { describe, expect, it } from 'vitest';

import { handler } from './handler.js';

describe('sync-gcal handler', () => {
  it('exports a function', () => {
    expect(typeof handler).toBe('function');
  });

  it('throws NotYetImplementedError at M0', async () => {
    // M0 stub contract: the handler exists but deliberately refuses to
    // run. @integrations replaces the body in M2; the test then flips.
    await expect(handler()).rejects.toThrow(/not implemented/i);
  });
});
