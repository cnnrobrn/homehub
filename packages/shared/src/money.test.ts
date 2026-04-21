import { describe, expect, it } from 'vitest';

import { formatMoney, fromCents, toCents, type Cents } from './money.js';

describe('money', () => {
  it('parses dollar strings into integer cents', () => {
    expect(toCents('12.34')).toBe(1234);
    expect(toCents('0.99')).toBe(99);
    expect(toCents('100')).toBe(10000);
  });

  it('accepts formatted strings with currency symbols and commas', () => {
    expect(toCents('$1,234.56')).toBe(123456);
    expect(toCents('  $42.00  ')).toBe(4200);
  });

  it('handles negative amounts', () => {
    expect(toCents('-5.00')).toBe(-500);
  });

  it('throws on malformed input rather than returning NaN', () => {
    expect(() => toCents('abc')).toThrow(/invalid dollar string/);
    expect(() => toCents('')).toThrow(/invalid dollar string/);
    expect(() => toCents('1.2.3')).toThrow(/invalid dollar string/);
  });

  it('round-trips through fromCents with floating-point precision', () => {
    const cents = toCents('1234.56');
    expect(fromCents(cents)).toBe(1234.56);
  });

  it('formats money in USD by default', () => {
    expect(formatMoney(1234 as Cents)).toBe('$12.34');
    expect(formatMoney(0 as Cents)).toBe('$0.00');
  });

  it('supports alternate currencies', () => {
    // Exact string varies by ICU, so just check the core is right.
    const out = formatMoney(1234 as Cents, 'EUR');
    expect(out).toMatch(/12\.34/);
  });
});
