/**
 * Typed error classes for the enrichment package.
 *
 * These wrap the underlying `ModelCallError` / `StructuredOutputError`
 * from `@homehub/worker-runtime` so callers can pattern-match the
 * reason for a model-path failure without reaching for `instanceof`
 * across package boundaries.
 */

abstract class EnrichmentError extends Error {
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
 * Thrown by the model-backed classifier when a Kimi-K2 call fails in a
 * way the caller should recover from by falling back to the
 * deterministic classifier. Causes include: schema validation failure
 * on the response, OpenRouter HTTP failure, exhausted model budget
 * (wrapped so the worker has a single catch site).
 */
export class ModelClassifierError extends EnrichmentError {
  readonly code = 'MODEL_CLASSIFIER_FAILED';
}

/**
 * Thrown by the model-backed extractor on the same conditions as
 * ModelClassifierError — kept separate so workers can log a distinct
 * signal (and so tests can assert on the exact failure mode without
 * pattern-matching the inner cause).
 */
export class ModelExtractorError extends EnrichmentError {
  readonly code = 'MODEL_EXTRACTOR_FAILED';
}
