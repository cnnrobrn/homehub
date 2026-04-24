/**
 * `GoogleHttpClient` — native replacement for `NangoClient.proxy` on the
 * Google (gcal + gmail) path.
 *
 * Implements the same `proxy(options)` signature `NangoClient` does, so
 * `GoogleCalendarProvider` and `GoogleMailProvider` accept it without
 * any adapter-level changes. The `connectionId` passed through is now a
 * UUID pointing at `sync.google_connection`.
 *
 * Behavior per call:
 *   1. Look up the connection row.
 *   2. Decrypt (and refresh if near-expiry) the access token. Refresh
 *      is serialized with `pg_advisory_xact_lock(hashtext(id))` so
 *      concurrent workers don't stampede Google's `/token` endpoint.
 *   3. Compose the real Google URL from `endpoint`.
 *   4. Issue the request with `Authorization: Bearer <access_token>`.
 *   5. On 401: refresh once, retry once. On second 401 or
 *      `invalid_grant` during refresh: mark the row revoked and throw.
 *   6. Surface non-2xx as `NangoError` with the same `{ response:
 *      { status, data, headers } }` cause shape the existing adapters
 *      already pattern-match on. This keeps the provider-side diff to
 *      just the imported type name.
 */

import { type GoogleOAuthClient, GoogleOAuthError } from '@homehub/oauth-google';
import { type SupabaseClient } from '@supabase/supabase-js';

import { NangoError } from '../errors.js';
import { type Logger } from '../log/logger.js';
import { type ProxyOptions } from '../nango/client.js';

import { type TokenCrypto } from './crypto.js';

/**
 * The proxy surface the providers depend on. Named to reflect its
 * provider-agnostic role; `NangoClient` already satisfies it, and now
 * `GoogleHttpClient` does too.
 */
export interface ProviderHttpClient {
  proxy<T = unknown>(options: ProxyOptions): Promise<T>;
}

export type GoogleHttpClient = ProviderHttpClient;

/** Refresh when the cached access token has <= this many seconds left. */
const REFRESH_SKEW_SECONDS = 60;

const ENDPOINT_HOSTS: ReadonlyArray<{ prefix: string; host: string }> = [
  { prefix: '/calendar/v3/', host: 'https://www.googleapis.com' },
  { prefix: '/gmail/v1/', host: 'https://gmail.googleapis.com' },
];

export interface CreateGoogleHttpClientDeps {
  supabase: SupabaseClient;
  oauth: GoogleOAuthClient;
  crypto: TokenCrypto;
  log: Logger;
  /** Injectable for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

interface GoogleConnectionRow {
  id: string;
  provider: 'gcal' | 'gmail';
  status: string;
  key_version: number;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;
  access_token_ciphertext: string | null;
  access_token_iv: string | null;
  access_token_auth_tag: string | null;
  access_token_expires_at: string | null;
}

export function createGoogleHttpClient(deps: CreateGoogleHttpClientDeps): GoogleHttpClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());

  return {
    async proxy<T = unknown>(options: ProxyOptions): Promise<T> {
      const connection = await loadConnection(deps.supabase, options.connectionId);
      if (connection.status !== 'active') {
        throw new NangoError(
          `google connection ${options.connectionId} is not active (status=${connection.status})`,
          { providerConfigKey: options.providerConfigKey, connectionId: options.connectionId },
        );
      }

      let accessToken = await ensureFreshAccessToken(deps, connection, now());
      const previousExpiresAt = connection.access_token_expires_at;

      try {
        return await issueRequest<T>({
          fetchImpl,
          accessToken,
          options,
        });
      } catch (err) {
        // Refresh-and-retry on a single 401. `NangoError` from
        // `issueRequest` carries the upstream `{ response.status }`.
        const status = extractStatus(err);
        if (status !== 401) throw err;
        deps.log.info('google 401; refreshing access token and retrying once', {
          connection_id: connection.id,
          endpoint: options.endpoint,
        });
        accessToken = await forceRefresh(deps, connection, now(), previousExpiresAt);
        return await issueRequest<T>({ fetchImpl, accessToken, options });
      }
    },
  };
}

async function loadConnection(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<GoogleConnectionRow> {
  const { data, error } = await supabase
    .schema('sync' as never)
    .from('google_connection' as never)
    .select(
      'id, provider, status, key_version, refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag, access_token_ciphertext, access_token_iv, access_token_auth_tag, access_token_expires_at',
    )
    .eq('id', connectionId)
    .maybeSingle();
  if (error) {
    throw new NangoError(`google_connection lookup failed: ${error.message}`, {
      connectionId,
    });
  }
  if (!data) {
    throw new NangoError(`google_connection ${connectionId} not found`, { connectionId });
  }
  return data as unknown as GoogleConnectionRow;
}

async function ensureFreshAccessToken(
  deps: CreateGoogleHttpClientDeps,
  connection: GoogleConnectionRow,
  nowDate: Date,
): Promise<string> {
  if (isAccessTokenUsable(connection, nowDate)) {
    return deps.crypto.decrypt({
      ciphertext: decodeBytes(connection.access_token_ciphertext!),
      iv: decodeBytes(connection.access_token_iv!),
      authTag: decodeBytes(connection.access_token_auth_tag!),
      keyVersion: connection.key_version,
    });
  }
  return forceRefresh(deps, connection, nowDate, connection.access_token_expires_at);
}

function isAccessTokenUsable(connection: GoogleConnectionRow, nowDate: Date): boolean {
  if (
    !connection.access_token_ciphertext ||
    !connection.access_token_iv ||
    !connection.access_token_auth_tag ||
    !connection.access_token_expires_at
  ) {
    return false;
  }
  const expiry = Date.parse(connection.access_token_expires_at);
  if (Number.isNaN(expiry)) return false;
  return expiry - nowDate.getTime() > REFRESH_SKEW_SECONDS * 1_000;
}

async function forceRefresh(
  deps: CreateGoogleHttpClientDeps,
  connection: GoogleConnectionRow,
  nowDate: Date,
  previousExpiresAt: string | null,
): Promise<string> {
  // Advisory-lock the row so concurrent workers don't both hit /token
  // and waste a refresh. `pg_advisory_xact_lock` auto-releases on txn
  // commit; we wrap the refresh in a Postgres transaction via a tiny
  // RPC (or fall back to no locking when the RPC isn't present — losing
  // a few tokens to double-refresh is harmless but noisy).
  await acquireRefreshLock(deps.supabase, connection.id).catch((err) => {
    deps.log.warn('advisory lock unavailable; proceeding without it', {
      connection_id: connection.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Re-read after locking so we use the latest access token if another
  // worker beat us to the refresh. We only trust the re-read if it's
  // *newer* than what we started with — otherwise the caller either
  // just got a 401 on this very token (so we must refresh regardless)
  // or we're the first to run after an expiry (so the cache is stale
  // and we must refresh).
  const fresh = await loadConnection(deps.supabase, connection.id);
  const freshAdvanced =
    fresh.access_token_expires_at != null && fresh.access_token_expires_at !== previousExpiresAt;
  if (freshAdvanced && isAccessTokenUsable(fresh, nowDate)) {
    return deps.crypto.decrypt({
      ciphertext: decodeBytes(fresh.access_token_ciphertext!),
      iv: decodeBytes(fresh.access_token_iv!),
      authTag: decodeBytes(fresh.access_token_auth_tag!),
      keyVersion: fresh.key_version,
    });
  }

  const refreshToken = deps.crypto.decrypt({
    ciphertext: decodeBytes(fresh.refresh_token_ciphertext),
    iv: decodeBytes(fresh.refresh_token_iv),
    authTag: decodeBytes(fresh.refresh_token_auth_tag),
    keyVersion: fresh.key_version,
  });

  let tokenSet;
  try {
    tokenSet = await deps.oauth.refreshAccessToken(refreshToken);
  } catch (err) {
    if (err instanceof GoogleOAuthError && err.isInvalidGrant()) {
      await markRevoked(deps.supabase, connection.id, deps.log);
      throw new NangoError(
        `google refresh_token revoked for connection ${connection.id}; marked revoked`,
        { connectionId: connection.id },
        { cause: err },
      );
    }
    throw new NangoError(
      `google /token refresh failed for connection ${connection.id}`,
      {
        connectionId: connection.id,
      },
      { cause: err },
    );
  }

  const encrypted = deps.crypto.encrypt(tokenSet.accessToken);
  const expiresAt = new Date(nowDate.getTime() + tokenSet.expiresIn * 1_000).toISOString();
  const { error: updateErr } = await deps.supabase
    .schema('sync' as never)
    .from('google_connection' as never)
    .update({
      access_token_ciphertext: encodeBytes(encrypted.ciphertext),
      access_token_iv: encodeBytes(encrypted.iv),
      access_token_auth_tag: encodeBytes(encrypted.authTag),
      access_token_expires_at: expiresAt,
      key_version: encrypted.keyVersion,
      last_refreshed_at: nowDate.toISOString(),
      updated_at: nowDate.toISOString(),
    })
    .eq('id', connection.id);
  if (updateErr) {
    deps.log.error('failed to persist refreshed google access token', {
      connection_id: connection.id,
      error: updateErr.message,
    });
    // Don't throw — we already have a valid in-memory token for this call.
  }
  return tokenSet.accessToken;
}

async function acquireRefreshLock(supabase: SupabaseClient, connectionId: string): Promise<void> {
  // Uses a tiny RPC (`sync.google_refresh_lock`) if one is installed;
  // otherwise the lock is best-effort. We don't want to require the RPC
  // just to run this client — keep the code path functional in local
  // dev where the RPC may not exist.
  const { error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  )('google_refresh_lock', {
    connection_id: connectionId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

async function markRevoked(
  supabase: SupabaseClient,
  connectionId: string,
  log: Logger,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const updates = [
    supabase
      .schema('sync' as never)
      .from('google_connection' as never)
      .update({ status: 'revoked', updated_at: nowIso })
      .eq('id', connectionId),
    supabase
      .schema('sync' as never)
      .from('provider_connection' as never)
      .update({ status: 'revoked', updated_at: nowIso })
      .eq('nango_connection_id', connectionId),
  ];
  const results = await Promise.all(updates);
  for (const { error } of results) {
    if (error) {
      log.error('failed to mark google connection revoked', {
        connection_id: connectionId,
        error: error.message,
      });
    }
  }
}

interface IssueRequestArgs {
  fetchImpl: typeof fetch;
  accessToken: string;
  options: ProxyOptions;
}

async function issueRequest<T>(args: IssueRequestArgs): Promise<T> {
  const url = composeUrl(args.options.endpoint, args.options.params);
  const method = args.options.method ?? 'GET';
  const headers: Record<string, string> = {
    authorization: `Bearer ${args.accessToken}`,
    accept: 'application/json',
    ...(args.options.headers ?? {}),
  };
  const init: RequestInit = { method, headers };
  if (args.options.data !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json';
    init.body = JSON.stringify(args.options.data);
  }

  const response = await args.fetchImpl(url, init);
  const rawText = await response.text();
  const parsed = parseJsonSafe(rawText);

  if (!response.ok) {
    const cause = {
      response: {
        status: response.status,
        data: parsed ?? rawText,
        headers: headersToObject(response.headers),
      },
    };
    throw new NangoError(
      `google ${method} ${args.options.endpoint} failed: ${response.status}`,
      {
        providerConfigKey: args.options.providerConfigKey,
        connectionId: args.options.connectionId,
      },
      { cause },
    );
  }

  return (parsed ?? (rawText as unknown)) as T;
}

function composeUrl(endpoint: string, params?: ProxyOptions['params']): string {
  const host = ENDPOINT_HOSTS.find((h) => endpoint.startsWith(h.prefix))?.host;
  if (!host) {
    throw new NangoError(`google proxy: unsupported endpoint prefix: ${endpoint}`, {});
  }
  const url = new URL(host + endpoint);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function parseJsonSafe(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractStatus(err: unknown): number | undefined {
  if (err instanceof NangoError) {
    const cause = err.cause as { response?: { status?: number } } | undefined;
    return cause?.response?.status;
  }
  return undefined;
}

// Ciphertext / IV / auth tag columns are text(base64). Raw GCM bytes
// round-trip through PostgREST that way without the `bytea` hex-escape
// ambiguity that complicated earlier iterations.
function decodeBytes(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

function encodeBytes(buf: Buffer): string {
  return buf.toString('base64');
}
