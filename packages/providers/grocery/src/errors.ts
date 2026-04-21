/**
 * Typed errors for grocery providers.
 *
 * Callers (sync-grocery worker) catch these specifically:
 *   - `GroceryRateLimitError` → `nack` with the carried retry-after.
 *   - `GrocerySyncError` → terminal; route to dead-letter with reason.
 */

abstract class GroceryProviderError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class GrocerySyncError extends GroceryProviderError {
  readonly code = 'GROCERY_SYNC_ERROR';
}

export class GroceryRateLimitError extends GroceryProviderError {
  readonly code = 'GROCERY_RATE_LIMIT';
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number, options?: { cause?: unknown }) {
    super(message, options);
    this.retryAfterSeconds = Math.max(1, Math.min(retryAfterSeconds, 3_600));
  }
}

export class GroceryNotFoundError extends GroceryProviderError {
  readonly code = 'GROCERY_NOT_FOUND';
}
