/**
 * Unit tests for `GoogleHttpClient`.
 *
 * Strategy: real `TokenCrypto` (round-trips through actual AES-GCM), mock
 * Supabase via a handwritten query-builder stub, mock `GoogleOAuthClient`,
 * inject a `fetchImpl`. We cover:
 *   - Happy path with a fresh access token.
 *   - Near-expiry refresh triggers `/token`, persists new ciphertext.
 *   - 401 → refresh + retry succeeds.
 *   - `invalid_grant` on refresh flips the row to revoked.
 *   - Unsupported endpoint prefix throws before any network call.
 */

import { randomBytes } from 'node:crypto';

import { type GoogleOAuthClient, GoogleOAuthError } from '@homehub/oauth-google';
import { describe, expect, it, vi } from 'vitest';

import { type Logger } from '../log/logger.js';

import { createGoogleHttpClient } from './client.js';
import { createTokenCrypto } from './crypto.js';

const NOISY_LOGGER: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => NOISY_LOGGER,
} as unknown as Logger;

function makeCrypto() {
  return createTokenCrypto({
    activeKeyVersion: 1,
    keysByVersion: new Map([[1, randomBytes(32)]]),
  });
}

interface Row {
  id: string;
  provider: 'gcal' | 'gmail';
  status: 'active' | 'revoked' | 'errored';
  key_version: number;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;
  access_token_ciphertext: string | null;
  access_token_iv: string | null;
  access_token_auth_tag: string | null;
  access_token_expires_at: string | null;
  last_refreshed_at: string | null;
  updated_at: string;
}

function makeSupabase(initial: Row) {
  const rows = new Map<string, Row>([[initial.id, initial]]);
  const lastSelectError: { message: string } | null = null;
  // Minimal query-builder shim that handles the exact calls
  // createGoogleHttpClient makes: select().eq().maybeSingle() and
  // update(values).eq(column, value).
  const builder = {
    _lastTable: '' as 'google_connection' | 'provider_connection',
    _pendingUpdate: null as Partial<Row> | null,
    _updateFilter: null as { column: string; value: unknown } | null,
    select() {
      return this;
    },
    async maybeSingle() {
      if (lastSelectError) return { data: null, error: lastSelectError };
      const row = rows.get((this as { _eqValue?: string })._eqValue ?? initial.id);
      return { data: row ?? null, error: null };
    },
    eq(column: string, value: unknown) {
      if (this._pendingUpdate) {
        this._updateFilter = { column, value };
        return this;
      }
      (this as unknown as { _eqValue: unknown })._eqValue = value;
      return this;
    },
    update(values: Partial<Row>) {
      this._pendingUpdate = values;
      return this;
    },
    then(resolve: (v: unknown) => unknown) {
      // Supabase `.update(...).eq(...)` is awaited directly. We commit
      // the staged update when the builder is awaited.
      if (this._pendingUpdate && this._updateFilter?.column === 'id') {
        const target = rows.get(String(this._updateFilter.value));
        if (target) rows.set(target.id, { ...target, ...this._pendingUpdate });
      }
      if (this._pendingUpdate && this._updateFilter?.column === 'nango_connection_id') {
        const target = [...rows.values()].find(() => true);
        if (target) rows.set(target.id, { ...target, ...this._pendingUpdate });
      }
      this._pendingUpdate = null;
      this._updateFilter = null;
      return resolve({ data: null, error: null });
    },
  };
  const client = {
    schema: () => ({
      from: (table: string) => {
        builder._lastTable = table as 'google_connection';
        return builder;
      },
    }),
    rpc: async () => ({ error: null }),
  };
  return { client, rows };
}

function makeOauth(overrides: Partial<GoogleOAuthClient> = {}): GoogleOAuthClient {
  return {
    getAuthUrl: () => new URL('https://example.invalid'),
    exchangeCode: vi.fn(),
    refreshAccessToken: vi.fn(async () => ({
      accessToken: 'new-access',
      refreshToken: null,
      expiresIn: 3600,
      scope: 'x',
      tokenType: 'Bearer',
      idToken: null,
      idTokenPayload: null,
    })),
    revoke: vi.fn(),
    ...overrides,
  } as GoogleOAuthClient;
}

function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'content-type': 'application/json' } });
}

describe('GoogleHttpClient.proxy', () => {
  it('uses a fresh cached access token without refresh', async () => {
    const crypto = makeCrypto();
    const atBlob = crypto.encrypt('cached-at');
    const rtBlob = crypto.encrypt('refresh-value');
    const row: Row = {
      id: 'conn-1',
      provider: 'gcal',
      status: 'active',
      key_version: 1,
      refresh_token_ciphertext: rtBlob.ciphertext.toString('base64'),
      refresh_token_iv: rtBlob.iv.toString('base64'),
      refresh_token_auth_tag: rtBlob.authTag.toString('base64'),
      access_token_ciphertext: atBlob.ciphertext.toString('base64'),
      access_token_iv: atBlob.iv.toString('base64'),
      access_token_auth_tag: atBlob.authTag.toString('base64'),
      access_token_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      last_refreshed_at: null,
      updated_at: new Date().toISOString(),
    };
    const { client: supabase } = makeSupabase(row);
    const oauth = makeOauth();
    const fetchImpl: typeof fetch = vi.fn(async () =>
      makeResponse(200, { id: 'primary@example.com' }),
    );

    const http = createGoogleHttpClient({
      supabase: supabase as never,
      oauth,
      crypto,
      log: NOISY_LOGGER,
      fetchImpl,
    });
    const result = await http.proxy({
      providerConfigKey: 'google-calendar',
      connectionId: 'conn-1',
      endpoint: '/calendar/v3/calendars/primary',
    });
    expect((result as { id: string }).id).toBe('primary@example.com');
    expect(oauth.refreshAccessToken).not.toHaveBeenCalled();
    const call = vi.mocked(fetchImpl).mock.lastCall;
    expect(String(call?.[0])).toBe('https://www.googleapis.com/calendar/v3/calendars/primary');
    expect((call?.[1]?.headers as Record<string, string>).authorization).toBe('Bearer cached-at');
  });

  it('refreshes when the access token is near expiry and persists the new one', async () => {
    const crypto = makeCrypto();
    const rtBlob = crypto.encrypt('refresh-value');
    const row: Row = {
      id: 'conn-2',
      provider: 'gmail',
      status: 'active',
      key_version: 1,
      refresh_token_ciphertext: rtBlob.ciphertext.toString('base64'),
      refresh_token_iv: rtBlob.iv.toString('base64'),
      refresh_token_auth_tag: rtBlob.authTag.toString('base64'),
      access_token_ciphertext: null,
      access_token_iv: null,
      access_token_auth_tag: null,
      access_token_expires_at: null,
      last_refreshed_at: null,
      updated_at: new Date().toISOString(),
    };
    const { client: supabase, rows } = makeSupabase(row);
    const oauth = makeOauth();
    const fetchImpl: typeof fetch = vi.fn(async () => makeResponse(200, { messages: [] }));

    const http = createGoogleHttpClient({
      supabase: supabase as never,
      oauth,
      crypto,
      log: NOISY_LOGGER,
      fetchImpl,
    });
    await http.proxy({
      providerConfigKey: 'google-mail',
      connectionId: 'conn-2',
      endpoint: '/gmail/v1/users/me/messages',
    });
    expect(oauth.refreshAccessToken).toHaveBeenCalledWith('refresh-value');
    const updated = rows.get('conn-2')!;
    expect(updated.access_token_ciphertext).toBeTruthy();
    expect(updated.access_token_expires_at).toBeTruthy();
  });

  it('on 401 refreshes once and retries the request', async () => {
    const crypto = makeCrypto();
    const atBlob = crypto.encrypt('stale-at');
    const rtBlob = crypto.encrypt('refresh-value');
    const row: Row = {
      id: 'conn-3',
      provider: 'gcal',
      status: 'active',
      key_version: 1,
      refresh_token_ciphertext: rtBlob.ciphertext.toString('base64'),
      refresh_token_iv: rtBlob.iv.toString('base64'),
      refresh_token_auth_tag: rtBlob.authTag.toString('base64'),
      access_token_ciphertext: atBlob.ciphertext.toString('base64'),
      access_token_iv: atBlob.iv.toString('base64'),
      access_token_auth_tag: atBlob.authTag.toString('base64'),
      access_token_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      last_refreshed_at: null,
      updated_at: new Date().toISOString(),
    };
    const { client: supabase } = makeSupabase(row);
    const oauth = makeOauth();
    const fetchImpl: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(401, { error: { code: 401 } }))
      .mockResolvedValueOnce(makeResponse(200, { id: 'ok' }));

    const http = createGoogleHttpClient({
      supabase: supabase as never,
      oauth,
      crypto,
      log: NOISY_LOGGER,
      fetchImpl,
    });
    const result = await http.proxy({
      providerConfigKey: 'google-calendar',
      connectionId: 'conn-3',
      endpoint: '/calendar/v3/calendars/primary',
    });
    expect((result as { id: string }).id).toBe('ok');
    expect(oauth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('marks the connection revoked on invalid_grant during refresh', async () => {
    const crypto = makeCrypto();
    const rtBlob = crypto.encrypt('refresh-value');
    const row: Row = {
      id: 'conn-4',
      provider: 'gmail',
      status: 'active',
      key_version: 1,
      refresh_token_ciphertext: rtBlob.ciphertext.toString('base64'),
      refresh_token_iv: rtBlob.iv.toString('base64'),
      refresh_token_auth_tag: rtBlob.authTag.toString('base64'),
      access_token_ciphertext: null,
      access_token_iv: null,
      access_token_auth_tag: null,
      access_token_expires_at: null,
      last_refreshed_at: null,
      updated_at: new Date().toISOString(),
    };
    const { client: supabase, rows } = makeSupabase(row);
    const oauth = makeOauth({
      refreshAccessToken: vi.fn(async () => {
        throw new GoogleOAuthError('bad', { code: 'invalid_grant', httpStatus: 400 });
      }) as GoogleOAuthClient['refreshAccessToken'],
    });
    const fetchImpl: typeof fetch = vi.fn();

    const http = createGoogleHttpClient({
      supabase: supabase as never,
      oauth,
      crypto,
      log: NOISY_LOGGER,
      fetchImpl,
    });
    await expect(
      http.proxy({
        providerConfigKey: 'google-mail',
        connectionId: 'conn-4',
        endpoint: '/gmail/v1/users/me/messages',
      }),
    ).rejects.toThrow(/revoked/);
    expect(rows.get('conn-4')!.status).toBe('revoked');
  });

  it('rejects unsupported endpoint prefixes before any network call', async () => {
    const crypto = makeCrypto();
    const rtBlob = crypto.encrypt('refresh-value');
    const atBlob = crypto.encrypt('cached-at');
    const row: Row = {
      id: 'conn-5',
      provider: 'gcal',
      status: 'active',
      key_version: 1,
      refresh_token_ciphertext: rtBlob.ciphertext.toString('base64'),
      refresh_token_iv: rtBlob.iv.toString('base64'),
      refresh_token_auth_tag: rtBlob.authTag.toString('base64'),
      access_token_ciphertext: atBlob.ciphertext.toString('base64'),
      access_token_iv: atBlob.iv.toString('base64'),
      access_token_auth_tag: atBlob.authTag.toString('base64'),
      access_token_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      last_refreshed_at: null,
      updated_at: new Date().toISOString(),
    };
    const { client: supabase } = makeSupabase(row);
    const oauth = makeOauth();
    const fetchImpl: typeof fetch = vi.fn();

    const http = createGoogleHttpClient({
      supabase: supabase as never,
      oauth,
      crypto,
      log: NOISY_LOGGER,
      fetchImpl,
    });
    await expect(
      http.proxy({
        providerConfigKey: 'google-calendar',
        connectionId: 'conn-5',
        endpoint: '/not-a-real-google-api/x',
      }),
    ).rejects.toThrow(/unsupported endpoint prefix/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
