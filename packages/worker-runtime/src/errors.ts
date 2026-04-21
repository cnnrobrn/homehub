/**
 * Error classes used across the worker runtime.
 *
 * Every class carries a stable string `code` so log backends and metric
 * systems can filter on it without parsing message text. Messages are
 * human-readable and may change; codes are contract.
 *
 * Cause preservation: where a lower-level error triggered this one, pass
 * the original via the `cause` option and keep it on the error — we want
 * the full chain visible in Sentry.
 */

type WithCode = { readonly code: string };

abstract class HomeHubError extends Error implements WithCode {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    // V8-specific; safe to call — Node uses V8.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown by runtime call sites that depend on schema objects that the
 * data-model package has not shipped yet. The interface is stable; the
 * implementation is a stub until the relevant migration lands. Catching
 * this error is a code smell — the callers should never be invoking a
 * not-yet-implemented path in prod.
 */
export class NotYetImplementedError extends HomeHubError {
  readonly code = 'NOT_YET_IMPLEMENTED';
}

/**
 * Thrown when a model response cannot be parsed or validated against the
 * caller-supplied Zod schema after one corrective retry.
 */
export class StructuredOutputError extends HomeHubError {
  readonly code = 'STRUCTURED_OUTPUT_FAILED';
  readonly rawText: string;

  constructor(message: string, rawText: string, options?: { cause?: unknown }) {
    super(message, options);
    this.rawText = rawText;
  }
}

/**
 * Thrown when a model call fails after retries and fallback attempts.
 * The original upstream error is preserved on `.cause`.
 */
export class ModelCallError extends HomeHubError {
  readonly code = 'MODEL_CALL_FAILED';
  readonly model: string;

  constructor(message: string, model: string, options?: { cause?: unknown }) {
    super(message, options);
    this.model = model;
  }
}

/**
 * Thrown by the pgmq wrapper on unexpected RPC failures or malformed
 * queue state.
 */
export class QueueError extends HomeHubError {
  readonly code = 'QUEUE_ERROR';
  readonly queueName: string;

  constructor(message: string, queueName: string, options?: { cause?: unknown }) {
    super(message, options);
    this.queueName = queueName;
  }
}

/**
 * Thrown by the Nango client wrapper on HTTP or protocol errors.
 */
export class NangoError extends HomeHubError {
  readonly code = 'NANGO_ERROR';
  readonly providerConfigKey: string | undefined;
  readonly connectionId: string | undefined;

  constructor(
    message: string,
    context: { providerConfigKey?: string; connectionId?: string } = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.providerConfigKey = context.providerConfigKey;
    this.connectionId = context.connectionId;
  }
}
