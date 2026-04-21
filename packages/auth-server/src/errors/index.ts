/**
 * Typed errors for `@homehub/auth-server`.
 *
 * Server actions catch these and translate to `{ ok: false, error }`
 * envelopes. The `code` is stable — UI can switch on it. The `message`
 * is human-readable and allowed to change.
 *
 * Design notes:
 *   - All classes extend `AuthServerError` so consumers can narrow on one
 *     type and still get `code` + `message`.
 *   - `cause` preservation is intentional — Sentry (when wired in M0's
 *     observability pass) walks the chain.
 */

type WithCode = { readonly code: string };

export abstract class AuthServerError extends Error implements WithCode {
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
 * Input validation failed. Server actions return this to the UI as a
 * 400-style condition.
 */
export class ValidationError extends AuthServerError {
  readonly code = 'VALIDATION';
  readonly issues: readonly { path: string; message: string }[];

  constructor(
    message: string,
    issues: readonly { path: string; message: string }[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.issues = issues;
  }
}

/** Caller has no valid session. */
export class UnauthorizedError extends AuthServerError {
  readonly code = 'UNAUTHORIZED';
}

/** Caller is authenticated but lacks the required role / grant. */
export class ForbiddenError extends AuthServerError {
  readonly code = 'FORBIDDEN';
}

/** Referenced row does not exist OR RLS denies the read (indistinguishable from the client's perspective, deliberately). */
export class NotFoundError extends AuthServerError {
  readonly code = 'NOT_FOUND';
}

/** Attempted mutation violates a uniqueness / state constraint. */
export class ConflictError extends AuthServerError {
  readonly code = 'CONFLICT';
}

/**
 * Something unexpected failed (DB outage, programming bug). Wrap lower-
 * level errors in this to keep the boundary clean.
 */
export class InternalError extends AuthServerError {
  readonly code = 'INTERNAL';
}
