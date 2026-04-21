import { describe, expect, it } from 'vitest';

import { canonicalHash, canonicalJson } from './canonical-hash.js';

describe('canonicalJson', () => {
  it('sorts object keys', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles primitives', () => {
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('omits undefined properties (matching JSON.stringify)', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('handles nested structures', () => {
    expect(canonicalJson({ a: [1, { c: 3, b: 2 }] })).toBe('{"a":[1,{"b":2,"c":3}]}');
  });
});

describe('canonicalHash', () => {
  const base = {
    kind: 'outing_idea',
    household_id: 'h1',
    preview: { place: 'park', start: '2025-01-01T00:00:00Z' },
  };

  it('is stable across key orderings', () => {
    const a = canonicalHash(base);
    const b = canonicalHash({
      kind: 'outing_idea',
      household_id: 'h1',
      preview: { start: '2025-01-01T00:00:00Z', place: 'park' },
    });
    expect(a).toBe(b);
  });

  it('changes when the preview changes', () => {
    const a = canonicalHash(base);
    const b = canonicalHash({ ...base, preview: { place: 'museum' } });
    expect(a).not.toBe(b);
  });

  it('changes when the kind changes', () => {
    const a = canonicalHash(base);
    const b = canonicalHash({ ...base, kind: 'meal_swap' });
    expect(a).not.toBe(b);
  });

  it('changes when household_id changes', () => {
    const a = canonicalHash(base);
    const b = canonicalHash({ ...base, household_id: 'h2' });
    expect(a).not.toBe(b);
  });

  it('returns a 64-char hex sha256', () => {
    const h = canonicalHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
