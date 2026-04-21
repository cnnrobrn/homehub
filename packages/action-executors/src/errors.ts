/**
 * Typed errors for action executors.
 *
 * The action-executor worker's `execute-handler` classifies errors into
 * terminal (DLQ) vs transient (nack + retry). The executor layer expresses
 * permanence through the `PermanentExecutorError` class:
 *
 *   - `PermanentExecutorError` → terminal. The worker DLQs the message
 *     without retry. Use for 4xx provider responses, missing connections,
 *     payload validation failures, etc. — anything the same input will
 *     never succeed against.
 *   - Anything else (plain `Error`, fetch timeouts, `RateLimitError`s) →
 *     transient. The worker nack's and pgmq redelivers. Use for 429 /
 *     5xx provider responses, network flaps, or Supabase transient errors.
 *
 * Each permanent error carries a stable `code` string so log backends and
 * ops dashboards can filter without parsing message text.
 */

type WithCode = { readonly code: string };

/**
 * Executor-layer permanent failure. Caught by the action-executor's
 * `classifyError` shape via `code` so the worker DLQs rather than
 * retries. Subclasses must set `code` to a stable string.
 */
export class PermanentExecutorError extends Error implements WithCode {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentExecutorError';
    this.code = code;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Executor-layer transient failure. Mostly a documentation affordance —
 * callers can throw plain `Error` and the worker treats it as transient.
 * Use this when you want to be explicit about a retry being the right
 * outcome (e.g. after mapping a provider 5xx).
 */
export class TransientExecutorError extends Error implements WithCode {
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    message: string,
    options?: { cause?: unknown; retryAfterSeconds?: number },
  ) {
    super(message, options);
    this.name = 'TransientExecutorError';
    this.code = code;
    if (typeof options?.retryAfterSeconds === 'number') {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Convenience: wrap a Zod parse error into a permanent executor error
 * so callers don't have to branch on the error shape. The Zod message
 * is included verbatim; the code is `PAYLOAD_INVALID`.
 */
export function toPayloadInvalidError(err: unknown): PermanentExecutorError {
  const msg = err instanceof Error ? err.message : String(err);
  return new PermanentExecutorError('PAYLOAD_INVALID', `action payload invalid: ${msg}`, {
    cause: err,
  });
}

/**
 * Coerce a suggestion preview or action payload (typed as `Json` in
 * `@homehub/db`) into a plain record suitable for Zod parsing. The DB
 * types allow `null`, arrays, primitives, etc.; every executor expects
 * an object. Returns `{}` for anything non-object so the schema layer
 * reports a clean validation error.
 */
export function coerceRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
