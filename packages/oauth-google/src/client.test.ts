/**
 * Unit tests for `createGoogleOAuthClient`.
 *
 * Strategy: inject a `fetchImpl` mock. We assert the request bodies we
 * send to Google, the shape we hand back to callers, and the error
 * mapping (invalid_grant → `GoogleOAuthError.isInvalidGrant()`).
 */

import { describe, expect, it, vi } from 'vitest';

import { createGoogleOAuthClient } from './client.js';
import { GoogleOAuthError } from './errors.js';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function makeIdToken(payload: Record<string, unknown>): string {
  // Signature is ignored by our decoder — anything non-empty works.
  return `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`;
}

function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'content-type': 'application/json' } });
}

const BASE_CONFIG = {
  clientId: 'client.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'https://app.example.com/api/oauth/google/callback',
};

describe('getAuthUrl', () => {
  it('composes the authorize URL with PKCE + offline consent', () => {
    const client = createGoogleOAuthClient({ ...BASE_CONFIG, fetchImpl: vi.fn() });
    const url = client.getAuthUrl({
      state: 'state-123',
      codeChallenge: 'challenge-abc',
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'],
      loginHint: 'user@example.com',
    });
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(BASE_CONFIG.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(BASE_CONFIG.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('login_hint')).toBe('user@example.com');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
  });
});

describe('exchangeCode', () => {
  it('posts the authorization-code grant and parses the token response', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      makeResponse(200, {
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3599,
        scope: 'openid email',
        token_type: 'Bearer',
        id_token: makeIdToken({ sub: '109', email: 'u@e.com' }),
      }),
    );
    const client = createGoogleOAuthClient({ ...BASE_CONFIG, fetchImpl });
    const result = await client.exchangeCode({ code: 'code-x', codeVerifier: 'verifier-x' });
    expect(result.accessToken).toBe('at-1');
    expect(result.refreshToken).toBe('rt-1');
    expect(result.expiresIn).toBe(3599);
    expect(result.idTokenPayload?.sub).toBe('109');
    expect(result.idTokenPayload?.email).toBe('u@e.com');

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = vi.mocked(fetchImpl).mock.lastCall;
    expect(call?.[0]).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(String(call?.[1]?.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-x');
    expect(body.get('code_verifier')).toBe('verifier-x');
    expect(body.get('client_secret')).toBe('secret');
  });

  it('throws when the exchange omits a refresh token', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      makeResponse(200, {
        access_token: 'at-1',
        expires_in: 3599,
        scope: 'openid email',
        token_type: 'Bearer',
      }),
    );
    const client = createGoogleOAuthClient({ ...BASE_CONFIG, fetchImpl });
    await expect(client.exchangeCode({ code: 'c', codeVerifier: 'v' })).rejects.toBeInstanceOf(
      GoogleOAuthError,
    );
  });

  it('maps invalid_grant to an isInvalidGrant() error', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      makeResponse(400, { error: 'invalid_grant', error_description: 'bad code' }),
    );
    const client = createGoogleOAuthClient({ ...BASE_CONFIG, fetchImpl });
    try {
      await client.exchangeCode({ code: 'c', codeVerifier: 'v' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleOAuthError);
      expect((err as GoogleOAuthError).isInvalidGrant()).toBe(true);
    }
  });
});

describe('refreshAccessToken', () => {
  it('posts the refresh_token grant and returns a new access token', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      makeResponse(200, {
        access_token: 'at-2',
        expires_in: 3600,
        scope: 'openid email',
        token_type: 'Bearer',
      }),
    );
    const client = createGoogleOAuthClient({ ...BASE_CONFIG, fetchImpl });
    const result = await client.refreshAccessToken('rt-original');
    expect(result.accessToken).toBe('at-2');
    expect(result.refreshToken).toBeNull(); // Google omits on refresh; expected.
    const call = vi.mocked(fetchImpl).mock.lastCall;
    const body = new URLSearchParams(String(call?.[1]?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-original');
  });
});

describe('revoke', () => {
  it('swallows a 400 invalid_token as success', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      makeResponse(400, { error: 'invalid_token' }),
    );
    const client = createGoogleOAuthClient({ ...BASE_CONFIG, fetchImpl });
    await expect(client.revoke('rt-dead')).resolves.toBeUndefined();
  });

  it('throws on other non-2xx responses', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => makeResponse(500, { error: 'server_error' }));
    const client = createGoogleOAuthClient({ ...BASE_CONFIG, fetchImpl });
    await expect(client.revoke('rt')).rejects.toBeInstanceOf(GoogleOAuthError);
  });
});
