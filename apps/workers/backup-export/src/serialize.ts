/**
 * Deterministic serialization helpers for the household export worker.
 *
 * `toNdjson` produces one JSON-encoded row per line. Rows are sorted by
 * the primary key (default `id`, caller can override) so two runs over
 * the same data produce byte-identical output — that's load-bearing for
 * the manifest hash test.
 *
 * `makeManifest` wraps metadata + row counts into a single JSON blob.
 */

export interface NdjsonOptions {
  /** Primary key column used to sort rows. Defaults to `id`. */
  sortKey?: string;
}

/**
 * Stable JSON stringify: sorts object keys alphabetically so whitespace
 * + key-order differences don't shift the byte stream. Arrays are
 * preserved in-place because order is semantically meaningful for them.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    // Drop undefined entries to match JSON.stringify semantics.
    if (v === undefined) return null;
    return `${JSON.stringify(k)}:${stableStringify(v)}`;
  });
  return `{${parts.filter((p): p is string => p !== null).join(',')}}`;
}

export function toNdjson(
  rows: ReadonlyArray<Record<string, unknown>>,
  options: NdjsonOptions = {},
): string {
  const key = options.sortKey ?? 'id';
  const sorted = [...rows].sort((a, b) => {
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    if (av === bv) return 0;
    // Coerce to string for a stable lexical sort. Rows without a
    // `sortKey` fall back to empty string and land in a deterministic
    // spot.
    return String(av) < String(bv) ? -1 : 1;
  });
  return sorted.map((r) => stableStringify(r)).join('\n');
}

export interface ManifestInput {
  householdId: string;
  schemaVersion: number;
  exportedAt: string;
  rowCounts: Record<string, number>;
}

export function makeManifest(input: ManifestInput): string {
  return stableStringify({
    household_id: input.householdId,
    schema_version: input.schemaVersion,
    exported_at: input.exportedAt,
    row_counts: input.rowCounts,
  });
}
