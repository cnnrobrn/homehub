import { describe, expect, it } from 'vitest';

import { uuid } from './ids.js';

describe('uuid', () => {
  it('returns a v4 UUID string', () => {
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns distinct values on successive calls', () => {
    const a = uuid();
    const b = uuid();
    expect(a).not.toBe(b);
  });
});
