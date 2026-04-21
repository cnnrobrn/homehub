import { describe, expect, it } from 'vitest';

import { addDays, addHours, addMinutes, fromIso, toIso } from './time.js';

describe('time', () => {
  it('round-trips ISO-8601 strings', () => {
    const d = new Date('2026-04-20T12:00:00.000Z');
    expect(toIso(d)).toBe('2026-04-20T12:00:00.000Z');
    expect(fromIso(toIso(d)).getTime()).toBe(d.getTime());
  });

  it('throws on invalid ISO input', () => {
    expect(() => fromIso('not-a-date')).toThrow(/invalid ISO-8601/);
  });

  it('adds minutes, hours, and days without mutating the input', () => {
    const base = new Date('2026-04-20T00:00:00.000Z');
    expect(toIso(addMinutes(base, 30))).toBe('2026-04-20T00:30:00.000Z');
    expect(toIso(addHours(base, 2))).toBe('2026-04-20T02:00:00.000Z');
    expect(toIso(addDays(base, 1))).toBe('2026-04-21T00:00:00.000Z');
    // Base was not mutated.
    expect(toIso(base)).toBe('2026-04-20T00:00:00.000Z');
  });
});
