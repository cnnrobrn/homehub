/**
 * Typed errors for email providers.
 *
 * Callers (sync-gmail worker) catch these specifically:
 *   - `RateLimitError` → `nack` with the carried retry-after delay.
 *   - `HistoryIdExpiredError` → reset the historyId cursor and requeue
 *     as `sync_full:gmail` (Gmail docs: 404 on history.list after ~7
 *     days or at provider discretion).
 *   - `EmailSyncError` → terminal; route to dead-letter with reason.
 *
 * Every class carries a stable string `code` so log backends and metric
 * systems can filter on it without parsing message text.
 */

type WithCode = { readonly code: string };

abstract class EmailProviderError extends Error implements WithCode {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Generic terminal failure for the provider adapter. Bubble up when the
 * response cannot be normalized or the transport returned an unexpected
 * shape. The worker should route these to the DLQ.
 */
export class EmailSyncError extends EmailProviderError {
  readonly code = 'EMAIL_SYNC_ERROR';
}

/**
 * Signals that the provider rejected the stored history id (Gmail
 * returns `404 Not Found` with `reason=notFound` on `history.list`
 * after the history window elapses, or any time the id is otherwise
 * invalidated). The caller must drop the cursor, requeue as a full
 * sync, and reset state.
 */
export class HistoryIdExpiredError extends EmailProviderError {
  readonly code = 'HISTORY_ID_EXPIRED';
}

/**
 * Thrown on 429 or 403-with-rateLimitExceeded. Carries the retry-after
 * hint (seconds) so the worker can bump visibility correspondingly.
 */
export class RateLimitError extends EmailProviderError {
  readonly code = 'RATE_LIMIT';
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number, options?: { cause?: unknown }) {
    super(message, options);
    // Clamp to a sane window. Gmail occasionally returns header-less 429s;
    // the default of 30s matches pgmq's default nack delay.
    this.retryAfterSeconds = Math.max(1, Math.min(retryAfterSeconds, 3_600));
  }
}
