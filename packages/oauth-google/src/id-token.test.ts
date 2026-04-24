import { describe, expect, it } from 'vitest';

import { decodeIdTokenPayload } from './id-token.js';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

describe('decodeIdTokenPayload', () => {
  it('pulls sub + email from a well-formed token', () => {
    const jwt = `${b64url({ alg: 'RS256' })}.${b64url({ sub: 'abc', email: 'u@e.com', email_verified: true })}.sig`;
    const payload = decodeIdTokenPayload(jwt);
    expect(payload.sub).toBe('abc');
    expect(payload.email).toBe('u@e.com');
    expect(payload.email_verified).toBe(true);
  });

  it('throws when the middle segment is missing sub', () => {
    const jwt = `${b64url({ alg: 'RS256' })}.${b64url({ email: 'u@e.com' })}.sig`;
    expect(() => decodeIdTokenPayload(jwt)).toThrow(/missing sub/);
  });

  it('throws when the token shape is wrong', () => {
    expect(() => decodeIdTokenPayload('not.a.jwt.format')).toThrow();
  });
});
