/**
 * Typed errors for calendar providers.
 *
 * Callers (sync-gcal worker) catch these specifically:
 *   - `RateLimitError` → `nack` with the carried retry-after delay.
 *   - `FullResyncRequiredError` → re-enqueue as `sync_full:gcal` and drop
 *     the stored sync token.
 *   - `CalendarSyncError` → terminal; route to dead-letter with reason.
 *
 * Every class carries a stable string `code` so log backends and metric
 * systems can filter on it without parsing message text.
 */

type WithCode = { readonly code: string };

abstract class CalendarProviderError extends Error implements WithCode {
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
export class CalendarSyncError extends CalendarProviderError {
  readonly code = 'CALENDAR_SYNC_ERROR';
}

/**
 * Signals that the provider rejected the stored `syncToken` (Google
 * returns `410 Gone` after ~7 days, or any time the token is otherwise
 * invalidated). The caller must drop the token, requeue as a full sync,
 * and reset its cursor.
 */
export class FullResyncRequiredError extends CalendarProviderError {
  readonly code = 'FULL_RESYNC_REQUIRED';
}

/**
 * Thrown on 429 or 403-with-quotaExceeded. Carries the retry-after hint
 * (seconds) so the worker can bump visibility correspondingly.
 */
export class RateLimitError extends CalendarProviderError {
  readonly code = 'RATE_LIMIT';
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number, options?: { cause?: unknown }) {
    super(message, options);
    // Clamp to a sane window. Google occasionally returns header-less 429s;
    // the default of 30s matches pgmq's default nack delay.
    this.retryAfterSeconds = Math.max(1, Math.min(retryAfterSeconds, 3_600));
  }
}
