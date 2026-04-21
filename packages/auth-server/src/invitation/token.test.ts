import { describe, expect, it } from 'vitest';

import { generateInvitationToken, hashInvitationToken, tokensMatch } from './token.js';

const SECRET = 'a'.repeat(64);

describe('generateInvitationToken', () => {
  it('returns 43-char base64url token + hex hash', () => {
    const { token, tokenHash } = generateInvitationToken(SECRET);
    // 32 bytes -> ceil(32 / 3) * 4 = 44 base64 chars = 43 base64url (no padding).
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique tokens per call', () => {
    const a = generateInvitationToken(SECRET);
    const b = generateInvitationToken(SECRET);
    expect(a.token).not.toEqual(b.token);
    expect(a.tokenHash).not.toEqual(b.tokenHash);
  });

  it('hash is deterministic for same (token, secret)', () => {
    const { token } = generateInvitationToken(SECRET);
    expect(hashInvitationToken(token, SECRET)).toEqual(hashInvitationToken(token, SECRET));
  });

  it('different secret yields different hash for same token', () => {
    const { token } = generateInvitationToken(SECRET);
    const otherSecret = 'b'.repeat(64);
    expect(hashInvitationToken(token, SECRET)).not.toEqual(hashInvitationToken(token, otherSecret));
  });
});

describe('tokensMatch', () => {
  it('returns true for identical hashes', () => {
    const { tokenHash } = generateInvitationToken(SECRET);
    expect(tokensMatch(tokenHash, tokenHash)).toBe(true);
  });

  it('returns false for different hashes', () => {
    const a = generateInvitationToken(SECRET).tokenHash;
    const b = generateInvitationToken(SECRET).tokenHash;
    expect(tokensMatch(a, b)).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(tokensMatch('abcd', 'abcdef')).toBe(false);
  });

  it('returns false for non-hex strings', () => {
    expect(tokensMatch('zz', 'zz')).toBe(false);
  });
});
