/**
 * Tests for the serialization helpers.
 *
 * Determinism is load-bearing: two export runs over identical data must
 * produce byte-identical output so the manifest hash is meaningful for
 * integrity verification.
 */

import { describe, expect, it } from 'vitest';

import { makeManifest, stableStringify, toNdjson } from './serialize.js';

describe('stableStringify', () => {
  it('sorts object keys alphabetically', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles nested objects deterministically', () => {
    const a = stableStringify({ b: { c: 1, a: 2 }, a: [1, 2] });
    const b = stableStringify({ a: [1, 2], b: { a: 2, c: 1 } });
    expect(a).toBe(b);
  });

  it('drops undefined fields to match JSON.stringify', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('emits null explicitly', () => {
    expect(stableStringify({ a: null })).toBe('{"a":null}');
  });
});

describe('toNdjson', () => {
  it('sorts rows by the given key and emits newline-delimited JSON', () => {
    const rows = [
      { id: 'b', value: 2 },
      { id: 'a', value: 1 },
    ];
    expect(toNdjson(rows)).toBe('{"id":"a","value":1}\n{"id":"b","value":2}');
  });

  it('produces byte-identical output on two runs', () => {
    const rows1 = [
      { id: 'b', data: { y: 1, x: 2 } },
      { id: 'a', data: { x: 1, y: 2 } },
    ];
    const rows2 = [
      { id: 'a', data: { y: 2, x: 1 } },
      { id: 'b', data: { x: 2, y: 1 } },
    ];
    expect(toNdjson(rows1)).toBe(toNdjson(rows2));
  });

  it('honors a custom sort key', () => {
    const rows = [{ pk: 'b' }, { pk: 'a' }];
    expect(toNdjson(rows, { sortKey: 'pk' })).toBe('{"pk":"a"}\n{"pk":"b"}');
  });
});

describe('makeManifest', () => {
  it('emits stable keys + row counts', () => {
    const m = makeManifest({
      householdId: 'h1',
      schemaVersion: 1,
      exportedAt: '2026-04-20T00:00:00Z',
      rowCounts: { 'app.event': 10, 'app.transaction': 5 },
    });
    expect(m).toBe(
      '{"exported_at":"2026-04-20T00:00:00Z","household_id":"h1","row_counts":{"app.event":10,"app.transaction":5},"schema_version":1}',
    );
  });
});
