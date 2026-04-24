/**
 * Errors raised by the native Google OAuth client.
 *
 * `GoogleOAuthError` is the catch-all for any non-2xx from Google's OAuth
 * endpoints. `code` mirrors the `error` field Google returns (e.g.
 * `invalid_grant`, `invalid_request`) so callers can switch on it —
 * `invalid_grant` in particular is the signal that a refresh token has
 * been revoked and the connection should be marked revoked.
 *
 * We keep this separate from `NangoError` in `@homehub/worker-runtime`
 * because the two client surfaces are deliberately isolated — code that
 * catches `NangoError` should not accidentally swallow a Google failure
 * and vice versa.
 */

export interface GoogleOAuthErrorPayload {
  error?: string;
  error_description?: string;
  [key: string]: unknown;
}

export class GoogleOAuthError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly payload: GoogleOAuthErrorPayload | undefined;

  constructor(
    message: string,
    opts: { code?: string; httpStatus: number; payload?: GoogleOAuthErrorPayload; cause?: unknown },
  ) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'GoogleOAuthError';
    this.code = opts.code ?? 'unknown';
    this.httpStatus = opts.httpStatus;
    this.payload = opts.payload;
  }

  /**
   * True when Google considers the refresh token permanently dead.
   * Callers should mark the connection revoked and stop retrying.
   */
  isInvalidGrant(): boolean {
    return this.code === 'invalid_grant';
  }
}
