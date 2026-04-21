/**
 * Money in HomeHub is stored as integer cents to keep arithmetic exact
 * (no floating-point surprises on sums or rounds). The `Cents` brand is
 * a type-level hint — at runtime it is still a `number`.
 */

type Brand<T, B> = T & { readonly __brand: B };
export type Cents = Brand<number, 'Cents'>;

/**
 * Parses a dollar-formatted string (e.g. `"12.34"`, `"$1,234.56"`) into
 * `Cents`. Throws on malformed input rather than returning NaN — silent
 * NaN propagates and corrupts downstream totals.
 *
 * Accepts an optional leading currency symbol and thousands separators,
 * rejects anything else. Rounds half-to-even (banker's rounding) is not
 * applied here because we expect inputs to already have at most 2
 * fractional digits; if a 3rd digit sneaks in, we round half-away-from
 * zero via `Math.round`.
 */
export function toCents(dollarStr: string): Cents {
  const cleaned = dollarStr.trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`money.toCents: invalid dollar string: ${dollarStr}`);
  }
  const dollars = Number.parseFloat(cleaned);
  const cents = Math.round(dollars * 100);
  return cents as Cents;
}

/**
 * Divides by 100 to give a plain number in dollars. Use when passing to
 * an external API that wants a decimal; use `formatMoney` for display.
 */
export function fromCents(cents: Cents, _currency: string = 'USD'): number {
  return (cents as number) / 100;
}

/**
 * Locale-aware currency formatting. Defaults to USD in `en-US`. Pass a
 * different currency code for EUR/GBP/etc.; the locale is intentionally
 * fixed because the UI decides locale separately.
 */
export function formatMoney(cents: Cents, currency: string = 'USD'): string {
  const dollars = (cents as number) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(dollars);
}
