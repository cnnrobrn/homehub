/**
 * Tests for the MCP auth middleware.
 *
 * Coverage:
 *   - Dev-allowlist hit → `AuthContext` with the seeded household/member.
 *   - Dev-allowlist miss → `InvalidTokenError`.
 *   - Production + member token → `NotYetImplementedError` (pending
 *     migration 0012).
 *   - Service-token round trip (sign → verify) → authorizes the
 *     matching `X-HomeHub-Household-Id` header.
 *   - Service-token with mismatched household header → `ForbiddenError`.
 *   - Service-token without the `MCP_SERVICE_HMAC_SECRET` env →
 *     `InvalidTokenError`.
 *   - Missing / non-bearer `Authorization` → `InvalidTokenError`.
 */

import { NotYetImplementedError } from '@homehub/worker-runtime';
import { describe, expect, it } from 'vitest';

import { type McpCoreEnv } from '../env.js';
import { ForbiddenError, InvalidTokenError } from '../errors.js';

import { createAuthMiddleware, signServiceToken } from './auth.js';

const HOUSEHOLD_A = 'a0000000-0000-4000-8000-000000000001';
const HOUSEHOLD_B = 'b0000000-0000-4000-8000-000000000002';
const MEMBER_A = 'c0000000-0000-4000-8000-000000000010';
const DEV_TOKEN = 'hh_mcp_devtoken123';

function makeEnv(patch: Partial<McpCoreEnv> = {}): McpCoreEnv {
  return {
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_HTTP_REFERER: 'https://homehub.app',
    OPENROUTER_APP_TITLE: 'HomeHub',
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    ...patch,
  } as unknown as McpCoreEnv;
}

describe('createAuthMiddleware — dev allowlist', () => {
  it('resolves a dev member token to an AuthContext', () => {
    const auth = createAuthMiddleware({
      env: makeEnv({ MCP_DEV_TOKENS: `${DEV_TOKEN}:${HOUSEHOLD_A}:${MEMBER_A}` }),
      nodeEnv: 'development',
    });
    const ctx = auth.authenticate({ authorization: `Bearer ${DEV_TOKEN}` });
    expect(ctx.kind).toBe('member');
    if (ctx.kind !== 'member') throw new Error('unreachable');
    expect(ctx.householdId).toBe(HOUSEHOLD_A);
    expect(ctx.memberId).toBe(MEMBER_A);
    expect(ctx.scopes).toEqual(['*']);
  });

  it('rejects unknown tokens with InvalidTokenError', () => {
    const auth = createAuthMiddleware({
      env: makeEnv({ MCP_DEV_TOKENS: `${DEV_TOKEN}:${HOUSEHOLD_A}:${MEMBER_A}` }),
      nodeEnv: 'development',
    });
    expect(() => auth.authenticate({ authorization: 'Bearer hh_mcp_unknown' })).toThrow(
      InvalidTokenError,
    );
  });

  it('rejects requests without a bearer token', () => {
    const auth = createAuthMiddleware({ env: makeEnv(), nodeEnv: 'development' });
    expect(() => auth.authenticate({})).toThrow(InvalidTokenError);
    expect(() => auth.authenticate({ authorization: 'Basic abc' })).toThrow(InvalidTokenError);
  });
});

describe('createAuthMiddleware — production', () => {
  it('throws NotYetImplementedError for member tokens until migration 0012 lands', () => {
    const auth = createAuthMiddleware({
      env: makeEnv({ MCP_DEV_TOKENS: `${DEV_TOKEN}:${HOUSEHOLD_A}:${MEMBER_A}` }),
      nodeEnv: 'production',
    });
    expect(() => auth.authenticate({ authorization: `Bearer ${DEV_TOKEN}` })).toThrow(
      NotYetImplementedError,
    );
  });
});

describe('createAuthMiddleware — service tokens', () => {
  const SECRET = 'shared-secret-with-enough-entropy';

  it('accepts a freshly-signed service token with the matching household header', () => {
    const token = signServiceToken({
      householdId: HOUSEHOLD_A,
      service: 'action-executor',
      secret: SECRET,
    });
    const auth = createAuthMiddleware({
      env: makeEnv({ MCP_SERVICE_HMAC_SECRET: SECRET }),
      nodeEnv: 'development',
    });
    const ctx = auth.authenticate({
      authorization: `Bearer ${token}`,
      'x-homehub-household-id': HOUSEHOLD_A,
    });
    expect(ctx.kind).toBe('service');
    if (ctx.kind !== 'service') throw new Error('unreachable');
    expect(ctx.householdId).toBe(HOUSEHOLD_A);
    expect(ctx.serviceName).toBe('action-executor');
  });

  it('rejects service tokens with a mismatched household header', () => {
    const token = signServiceToken({
      householdId: HOUSEHOLD_A,
      service: 'consolidator',
      secret: SECRET,
    });
    const auth = createAuthMiddleware({
      env: makeEnv({ MCP_SERVICE_HMAC_SECRET: SECRET }),
      nodeEnv: 'development',
    });
    expect(() =>
      auth.authenticate({
        authorization: `Bearer ${token}`,
        'x-homehub-household-id': HOUSEHOLD_B,
      }),
    ).toThrow(ForbiddenError);
  });

  it('rejects service tokens when MCP_SERVICE_HMAC_SECRET is unset', () => {
    const token = signServiceToken({
      householdId: HOUSEHOLD_A,
      service: 'action-executor',
      secret: SECRET,
    });
    const auth = createAuthMiddleware({ env: makeEnv(), nodeEnv: 'development' });
    expect(() =>
      auth.authenticate({
        authorization: `Bearer ${token}`,
        'x-homehub-household-id': HOUSEHOLD_A,
      }),
    ).toThrow(InvalidTokenError);
  });

  it('rejects service tokens whose signature does not verify', () => {
    const token = signServiceToken({
      householdId: HOUSEHOLD_A,
      service: 'action-executor',
      secret: SECRET,
    });
    // Flip a byte of the signature.
    const tampered = `${token.slice(0, -4)}dead`;
    const auth = createAuthMiddleware({
      env: makeEnv({ MCP_SERVICE_HMAC_SECRET: SECRET }),
      nodeEnv: 'development',
    });
    expect(() =>
      auth.authenticate({
        authorization: `Bearer ${tampered}`,
        'x-homehub-household-id': HOUSEHOLD_A,
      }),
    ).toThrow(InvalidTokenError);
  });

  it('rejects service tokens older than the 5-min skew window', () => {
    const SECRET_B = 'skew-test-secret-with-entropy';
    const staleTs = Math.floor(Date.now() / 1000) - 600; // 10 min
    const token = signServiceToken({
      householdId: HOUSEHOLD_A,
      service: 'consolidator',
      secret: SECRET_B,
      nowSec: staleTs,
    });
    const auth = createAuthMiddleware({
      env: makeEnv({ MCP_SERVICE_HMAC_SECRET: SECRET_B }),
      nodeEnv: 'development',
    });
    expect(() =>
      auth.authenticate({
        authorization: `Bearer ${token}`,
        'x-homehub-household-id': HOUSEHOLD_A,
      }),
    ).toThrow(InvalidTokenError);
  });
});
