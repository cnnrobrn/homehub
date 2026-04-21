/**
 * Typed errors for financial providers.
 *
 * Callers (sync-financial worker) catch these specifically:
 *   - `RateLimitError` → `nack` with the carried retry-after delay.
 *   - `CursorExpiredError` → reset the stored cursor and requeue as
 *     `sync_full:{provider}` (YNAB: 409 `knowledge_out_of_date`).
 *   - `FinancialSyncError` → terminal; route to dead-letter with reason.
 *
 * Every class carries a stable string `code` so log backends and metric
 * systems can filter on it without parsing message text.
 */

type WithCode = { readonly code: string };

abstract class FinancialProviderError extends Error implements WithCode {
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
export class FinancialSyncError extends FinancialProviderError {
  readonly code = 'FINANCIAL_SYNC_ERROR';
}

/**
 * Signals that the provider rejected the stored delta cursor.
 *
 * YNAB: returns `409` with `id = 'knowledge_out_of_date'` when the
 * `last_knowledge_of_server` we pass is too old for a delta reply. The
 * caller must drop the cursor, requeue as a full sync, and reset state.
 */
export class CursorExpiredError extends FinancialProviderError {
  readonly code = 'CURSOR_EXPIRED';
}

/**
 * Thrown on 429 / provider-specific rate-limit responses. Carries the
 * retry-after hint (seconds) so the worker can bump visibility
 * correspondingly.
 *
 * YNAB's rate limit is 200 req/hr per access token. When hit, YNAB
 * returns `429 Too Many Requests` without a `Retry-After` header — we
 * default to 300s (5 min) in that case so the next retry lands after
 * the quota resets enough to make forward progress.
 */
export class RateLimitError extends FinancialProviderError {
  readonly code = 'RATE_LIMIT';
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number, options?: { cause?: unknown }) {
    super(message, options);
    // Clamp to a sane window.
    this.retryAfterSeconds = Math.max(1, Math.min(retryAfterSeconds, 3_600));
  }
}
