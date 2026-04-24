/**
 * Native Google OAuth client.
 *
 * Thin wrapper over Google's OAuth 2.0 endpoints:
 *   - GET  https://accounts.google.com/o/oauth2/v2/auth     (authorize)
 *   - POST https://oauth2.googleapis.com/token              (exchange + refresh)
 *   - POST https://oauth2.googleapis.com/revoke             (revoke)
 *
 * Framework-free — called from both the Next.js callback route and the
 * worker-runtime `GoogleHttpClient` so it can't reach into either side.
 *
 * Why not `google-auth-library`? The four entry points we actually use
 * are one-line fetches each. The official library weighs ~50KB, pulls
 * in gaxios + gtoken + sundry JWT-verification plumbing we don't need
 * (see `id-token.ts` for why signature verification is skipped), and
 * insists on its own OAuth2 client class that we'd have to adapt to
 * both the web and worker contexts. Keep it simple.
 */

import { GoogleOAuthError, type GoogleOAuthErrorPayload } from './errors.js';
import { decodeIdTokenPayload, type GoogleIdTokenPayload } from './id-token.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injectable for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export interface BuildAuthUrlArgs {
  state: string;
  codeChallenge: string;
  scopes: readonly string[];
  /** Pre-fill the account picker with this email (UX hint only). */
  loginHint?: string;
}

export interface ExchangeCodeArgs {
  code: string;
  codeVerifier: string;
}

export interface TokenSet {
  accessToken: string;
  /**
   * Only present on initial exchange (and only when we sent
   * `prompt=consent&access_type=offline`). Absent on subsequent refresh
   * responses — callers must preserve the original refresh token across
   * refreshes.
   */
  refreshToken: string | null;
  /** Seconds. Convert to absolute expiry at the call site. */
  expiresIn: number;
  scope: string;
  tokenType: string;
  /** Present on initial exchange when `openid` was requested. */
  idToken: string | null;
  idTokenPayload: GoogleIdTokenPayload | null;
}

export interface GoogleOAuthClient {
  getAuthUrl(args: BuildAuthUrlArgs): URL;
  exchangeCode(args: ExchangeCodeArgs): Promise<TokenSet>;
  refreshAccessToken(refreshToken: string): Promise<TokenSet>;
  /** Best-effort revoke. 400 `invalid_token` is swallowed as a success. */
  revoke(token: string): Promise<void>;
}

export function createGoogleOAuthClient(config: GoogleOAuthClientConfig): GoogleOAuthClient {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error(
      'createGoogleOAuthClient: clientId, clientSecret, and redirectUri are required',
    );
  }
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    getAuthUrl(args) {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', args.scopes.join(' '));
      url.searchParams.set('state', args.state);
      url.searchParams.set('code_challenge', args.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      // `access_type=offline` + `prompt=consent` ensures Google returns a
      // refresh token on every successful exchange — including reconnect
      // flows where the user has already granted consent before. Without
      // `prompt=consent`, Google omits the refresh token on re-auth,
      // which breaks the long-lived sync path.
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('include_granted_scopes', 'true');
      if (args.loginHint) {
        url.searchParams.set('login_hint', args.loginHint);
      }
      return url;
    },

    async exchangeCode(args) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code_verifier: args.codeVerifier,
      });
      return tokenRequest(fetchImpl, body, { expectRefreshToken: true });
    },

    async refreshAccessToken(refreshToken) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      });
      return tokenRequest(fetchImpl, body, { expectRefreshToken: false });
    },

    async revoke(token) {
      const body = new URLSearchParams({ token });
      const response = await fetchImpl(REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (response.ok) return;
      // 400 invalid_token means the token was already revoked or expired.
      // Treat as success — the goal is "we are disconnected" and we are.
      const payload = await safeJson(response);
      if (response.status === 400 && (payload?.error === 'invalid_token' || !payload?.error)) {
        return;
      }
      throw new GoogleOAuthError(`google revoke failed: ${response.status}`, {
        code: typeof payload?.error === 'string' ? payload.error : 'unknown',
        httpStatus: response.status,
        ...(payload !== undefined ? { payload } : {}),
      });
    },
  };
}

async function tokenRequest(
  fetchImpl: typeof fetch,
  body: URLSearchParams,
  opts: { expectRefreshToken: boolean },
): Promise<TokenSet> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    const code = typeof payload?.error === 'string' ? payload.error : 'unknown';
    const desc =
      typeof payload?.error_description === 'string' ? payload.error_description : undefined;
    throw new GoogleOAuthError(`google /token failed: ${code}${desc ? ` — ${desc}` : ''}`, {
      code,
      httpStatus: response.status,
      ...(payload !== undefined ? { payload } : {}),
    });
  }
  if (!payload || typeof payload !== 'object') {
    throw new GoogleOAuthError('google /token returned non-object body', {
      httpStatus: response.status,
    });
  }
  const accessToken = payload.access_token;
  const expiresIn = payload.expires_in;
  const scope = payload.scope;
  const tokenType = payload.token_type;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new GoogleOAuthError('google /token response missing access_token', {
      httpStatus: response.status,
      payload,
    });
  }
  if (typeof expiresIn !== 'number') {
    throw new GoogleOAuthError('google /token response missing expires_in', {
      httpStatus: response.status,
      payload,
    });
  }
  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : null;
  if (opts.expectRefreshToken && !refreshToken) {
    throw new GoogleOAuthError(
      'google /token exchange omitted refresh_token; was `access_type=offline&prompt=consent` set?',
      { httpStatus: response.status, payload },
    );
  }
  const idToken = typeof payload.id_token === 'string' ? payload.id_token : null;
  const idTokenPayload = idToken ? decodeIdTokenPayload(idToken) : null;
  return {
    accessToken,
    refreshToken,
    expiresIn,
    scope: typeof scope === 'string' ? scope : '',
    tokenType: typeof tokenType === 'string' ? tokenType : 'Bearer',
    idToken,
    idTokenPayload,
  };
}

async function safeJson(response: Response): Promise<GoogleOAuthErrorPayload | undefined> {
  const text = await response.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as GoogleOAuthErrorPayload;
  } catch {
    return { error: 'non_json_response', error_description: text.slice(0, 256) };
  }
}
