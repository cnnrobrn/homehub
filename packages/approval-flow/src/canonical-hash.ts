/**
 * Deterministic canonical hash of a suggestion's preview payload.
 *
 * The hash is stored on `app.action.payload.suggestion_hash` at dispatch
 * time and re-verified by the executor before it invokes any provider
 * call. It is ALSO stored on `app.suggestion.canonical_hash` (once that
 * column lands via migration 0014) so the server-action approver can
 * detect whether a client-supplied preview has been swapped between
 * render and approval.
 *
 * Determinism matters: two serializations of the same preview must
 * produce the same hash regardless of object-key ordering. The
 * `canonicalJson` helper sorts keys recursively before stringification.
 *
 * We deliberately include `kind` and `household_id` in the hash because
 * a preview alone is not enough to uniquely identify what a member
 * thinks they're approving — swapping the kind in-flight (same preview,
 * different executor) would otherwise pass.
 */

import { createHash } from 'node:crypto';

/**
 * Input accepted by `canonicalHash`. A plain object plus the kind +
 * household_id so a preview swap plus a kind swap can't collude to
 * produce the same hash.
 */
export interface CanonicalHashInput {
  kind: string;
  household_id: string;
  preview: unknown;
}

/**
 * Recursively canonicalize a JSON-compatible value.
 *
 *   - `null`, booleans, and finite numbers serialize as themselves.
 *   - Strings are quoted and JSON-escaped.
 *   - Arrays preserve element order (order is semantic).
 *   - Objects have their keys sorted lexicographically so that
 *     `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash identically.
 *   - `undefined` values are omitted (matching JSON.stringify).
 *   - Non-JSON values (functions, symbols, BigInt) are coerced to
 *     their `String()` representation — callers should never feed
 *     these in, but we want a total function rather than throwing.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }

  if (typeof value === 'boolean') return String(value);

  if (typeof value === 'string') return JSON.stringify(value);

  if (typeof value === 'bigint') return JSON.stringify(value.toString());

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  // Functions / symbols / everything else.
  return JSON.stringify(String(value));
}

/**
 * Returns a stable hex-encoded sha256 of the canonical JSON form of
 * `input`. Same input → same hash, every time, across processes.
 */
export function canonicalHash(input: CanonicalHashInput): string {
  const canonical = canonicalJson({
    kind: input.kind,
    household_id: input.household_id,
    preview: input.preview ?? {},
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
