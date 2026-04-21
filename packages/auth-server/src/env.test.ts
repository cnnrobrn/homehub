import { describe, expect, it } from 'vitest';

import { authServerEnvSchema, resolveAuthServerEnv } from './env.js';

const VALID = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  INVITATION_TOKEN_SECRET: 'a'.repeat(64),
};

describe('authServerEnvSchema', () => {
  it('accepts a complete env', () => {
    const parsed = authServerEnvSchema.parse(VALID);
    expect(parsed.SUPABASE_URL).toBe('https://example.supabase.co');
    expect(parsed.INVITATION_TTL_DAYS).toBe(7);
  });

  it('rejects a short INVITATION_TOKEN_SECRET', () => {
    expect(() =>
      authServerEnvSchema.parse({ ...VALID, INVITATION_TOKEN_SECRET: 'short' }),
    ).toThrow();
  });

  it('coerces INVITATION_TTL_DAYS from string', () => {
    const parsed = authServerEnvSchema.parse({ ...VALID, INVITATION_TTL_DAYS: '3' });
    expect(parsed.INVITATION_TTL_DAYS).toBe(3);
  });

  it('rejects a non-url SUPABASE_URL', () => {
    expect(() => authServerEnvSchema.parse({ ...VALID, SUPABASE_URL: 'not-a-url' })).toThrow();
  });
});

describe('resolveAuthServerEnv', () => {
  it('falls back to NEXT_PUBLIC_ vars', () => {
    const { SUPABASE_URL: _u, SUPABASE_ANON_KEY: _a, ...rest } = VALID;
    void _u;
    void _a;
    const resolved = resolveAuthServerEnv({
      ...rest,
      NEXT_PUBLIC_SUPABASE_URL: 'https://nextpub.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'pub-key',
    } as NodeJS.ProcessEnv);
    expect(resolved.SUPABASE_URL).toBe('https://nextpub.supabase.co');
    expect(resolved.SUPABASE_ANON_KEY).toBe('pub-key');
  });

  it('explicit SUPABASE_URL overrides NEXT_PUBLIC_SUPABASE_URL', () => {
    const resolved = resolveAuthServerEnv({
      ...VALID,
      NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'other-key',
    } as NodeJS.ProcessEnv);
    expect(resolved.SUPABASE_URL).toBe(VALID.SUPABASE_URL);
  });
});
