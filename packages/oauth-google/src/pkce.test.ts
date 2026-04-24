import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generatePkcePair, generateState } from './pkce.js';

describe('generateState', () => {
  it('returns url-safe random strings of distinct value', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});

describe('generatePkcePair', () => {
  it('returns verifier+challenge where challenge = base64url(sha256(verifier))', () => {
    const pair = generatePkcePair();
    expect(pair.codeChallengeMethod).toBe('S256');
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    const expected = createHash('sha256')
      .update(pair.codeVerifier)
      .digest('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    expect(pair.codeChallenge).toBe(expected);
  });
});
