/**
 * Map a provider-layer error to the executor's permanent / transient
 * taxonomy.
 *
 * Provider adapters raise typed errors:
 *   - `RateLimitError` (429 / quotaExceeded)           → transient.
 *   - `CalendarSyncError` / `EmailSyncError` / …       → terminal unless
 *     the underlying cause is a 5xx (then transient).
 *   - Anything else                                     → transient.
 *
 * The executor runtime treats `PermanentExecutorError` as a DLQ signal
 * and any other throw as a retryable nack. We honor that contract here.
 */

import { RateLimitError as CalendarRateLimitError } from '@homehub/providers-calendar';
import { RateLimitError as EmailRateLimitError } from '@homehub/providers-email';

import { PermanentExecutorError, TransientExecutorError } from './errors.js';

/**
 * Inspect the `cause` chain for an HTTP status code. Provider adapters
 * wrap Nango errors that carry `cause.response.status` — we lift that
 * out to decide permanence.
 */
function httpStatusOf(err: unknown): number | undefined {
  const cause = (err as { cause?: unknown })?.cause;
  const response = (cause as { response?: { status?: number } })?.response;
  if (response && typeof response.status === 'number') return response.status;
  // Nango wraps the axios error one level deeper.
  const innerCause = (cause as { cause?: unknown })?.cause;
  const innerResponse = (innerCause as { response?: { status?: number } })?.response;
  if (innerResponse && typeof innerResponse.status === 'number') return innerResponse.status;
  return undefined;
}

/**
 * Rethrow the input as the appropriate executor error type. Never
 * returns normally — always throws.
 *
 * @param code a stable code to stamp on the permanent error (e.g.
 *   `'google_calendar_write_failed'`).
 */
export function throwAsExecutorError(err: unknown, code: string): never {
  if (err instanceof CalendarRateLimitError || err instanceof EmailRateLimitError) {
    throw new TransientExecutorError('PROVIDER_RATE_LIMITED', err.message, {
      cause: err,
      retryAfterSeconds: err.retryAfterSeconds,
    });
  }

  const status = httpStatusOf(err);
  if (status !== undefined) {
    // 5xx + 429 → transient. Everything else 4xx → permanent.
    if (status >= 500 || status === 429) {
      throw new TransientExecutorError(code, err instanceof Error ? err.message : String(err), {
        cause: err,
      });
    }
    if (status >= 400) {
      throw new PermanentExecutorError(code, err instanceof Error ? err.message : String(err), {
        cause: err,
      });
    }
  }

  // Unknown error shape — treat as transient so the worker retries.
  // If the same failure recurs, pgmq's default max-attempts routes it
  // to the DLQ on its own.
  throw new TransientExecutorError(code, err instanceof Error ? err.message : String(err), {
    cause: err,
  });
}
