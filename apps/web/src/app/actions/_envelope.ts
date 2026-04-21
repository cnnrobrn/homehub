/**
 * Shared `Ok / Err` envelope + error translator for server actions.
 *
 * Server Actions must never throw across the RPC boundary (Next.js
 * serializes thrown errors with reduced fidelity and clients can't
 * narrow on the type). Every action catches, inspects the error, and
 * returns `{ ok: false, error: { code, message, ...extras } }`.
 */

import { AuthServerError, ValidationError } from '@homehub/auth-server';

export type Ok<T> = { ok: true; data: T };
export type Err = {
  ok: false;
  error: {
    code: string;
    message: string;
    issues?: readonly { path: string; message: string }[];
  };
};
export type ActionResult<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function toErr(err: unknown): Err {
  if (err instanceof ValidationError) {
    return { ok: false, error: { code: err.code, message: err.message, issues: err.issues } };
  }
  if (err instanceof AuthServerError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  // Unknown / internal. Avoid leaking details to the client.

  console.error('[server-action] unexpected error', err);
  return { ok: false, error: { code: 'INTERNAL', message: 'internal error' } };
}
