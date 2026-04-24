/**
 * One-line wiring for the GoogleHttpClient that workers use.
 *
 * Workers were historically `const nango = createNangoClient(env); const
 * calendar = createGoogleCalendarProvider({ nango });` — two lines each.
 * The google-native path is three deps (oauth + crypto + http) composed
 * from the same env, so we factor the boilerplate here. Workers shrink
 * to `const http = createGoogleProviderHttpClient({ env, supabase, log });`.
 */

import { createGoogleOAuthClient } from '@homehub/oauth-google';
import { type SupabaseClient } from '@supabase/supabase-js';

import { type WorkerRuntimeEnv } from '../env.js';
import { type Logger } from '../log/logger.js';

import { createGoogleHttpClient, type GoogleHttpClient } from './client.js';
import { createTokenCryptoFromEnv, isTokenCryptoConfigured } from './crypto.js';

export class GoogleOAuthNotConfiguredError extends Error {
  readonly code = 'GOOGLE_OAUTH_NOT_CONFIGURED';
}

export function isGoogleOAuthConfigured(env: WorkerRuntimeEnv): boolean {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REDIRECT_URI &&
    isTokenCryptoConfigured(process.env),
  );
}

export function createGoogleProviderHttpClient(args: {
  env: WorkerRuntimeEnv;
  /**
   * Service-role Supabase client. We accept the generic default shape
   * here so workers don't need to cast; inside `createGoogleHttpClient`
   * the client is only ever used via `.schema('sync').from(...)` which
   * is a valid operation on any Supabase client regardless of its
   * parameterized Database type.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any, any, any>;
  log: Logger;
}): GoogleHttpClient {
  const { env, supabase, log } = args;
  if (
    !env.GOOGLE_OAUTH_CLIENT_ID ||
    !env.GOOGLE_OAUTH_CLIENT_SECRET ||
    !env.GOOGLE_OAUTH_REDIRECT_URI
  ) {
    throw new GoogleOAuthNotConfiguredError(
      'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI must all be set',
    );
  }
  if (!isTokenCryptoConfigured(process.env)) {
    throw new GoogleOAuthNotConfiguredError(
      'GOOGLE_TOKEN_ENCRYPTION_KEY_V{N} must be set (base64, 32 bytes)',
    );
  }
  const oauth = createGoogleOAuthClient({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });
  const crypto = createTokenCryptoFromEnv(process.env);
  return createGoogleHttpClient({ supabase, oauth, crypto, log });
}
