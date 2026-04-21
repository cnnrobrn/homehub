import { describe, expect, it } from 'vitest';

import { handler } from './handler.js';
import { verifyHmac } from './hmac.js';

describe('webhook-ingest handler', () => {
  it('exports a function', () => {
    expect(typeof handler).toBe('function');
  });

  it('throws NotYetImplementedError at M0', async () => {
    await expect(
      handler({ provider: 'unknown', rawBody: Buffer.from(''), headers: {} }),
    ).rejects.toThrow(/not implemented/i);
  });
});

describe('verifyHmac stub', () => {
  it('throws NotYetImplementedError', () => {
    expect(() =>
      verifyHmac({
        provider: 'unknown',
        rawBody: Buffer.from(''),
        headers: {},
        secret: 'secret',
      }),
    ).toThrow(/not implemented|scaffold/i);
  });
});
