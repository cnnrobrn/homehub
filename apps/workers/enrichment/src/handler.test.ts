import { describe, expect, it } from 'vitest';

import { handler } from './handler.js';

describe('enrichment handler', () => {
  it('exports a function', () => {
    expect(typeof handler).toBe('function');
  });

  it('throws NotYetImplementedError at M0', async () => {
    await expect(handler()).rejects.toThrow(/not implemented/i);
  });
});
