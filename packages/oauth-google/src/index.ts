/**
 * `@homehub/oauth-google` — native Google OAuth client.
 *
 * Public surface: authorize-URL builder, code exchange, refresh, revoke,
 * id_token payload decoder, scope constants, PKCE + state generators,
 * and the error type. Both the web callback route and the worker-runtime
 * `GoogleHttpClient` import from this barrel.
 */

export {
  createGoogleOAuthClient,
  type BuildAuthUrlArgs,
  type ExchangeCodeArgs,
  type GoogleOAuthClient,
  type GoogleOAuthClientConfig,
  type TokenSet,
} from './client.js';

export { GoogleOAuthError, type GoogleOAuthErrorPayload } from './errors.js';

export { decodeIdTokenPayload, type GoogleIdTokenPayload } from './id-token.js';

export { generatePkcePair, generateState, type PkcePair } from './pkce.js';

export {
  GOOGLE_BASE_SCOPES,
  GOOGLE_CALENDAR_SCOPES,
  scopesForCalendar,
  scopesForGmail,
} from './scopes.js';
