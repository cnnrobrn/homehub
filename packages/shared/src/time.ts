/**
 * Small time helpers. We stick to the platform `Date` object and ISO-8601
 * strings to avoid a date-library dependency; when we later need
 * calendar-aware arithmetic (DST, timezones) we'll reach for
 * `Temporal`-the-proposal or a specific library on a case-by-case basis.
 */

export function now(): Date {
  return new Date();
}

/**
 * Formats a Date as ISO-8601 with millisecond precision and a `Z` suffix.
 * Matches Postgres `timestamptz` JSON output, which keeps equality checks
 * simple when round-tripping through the DB.
 */
export function toIso(d: Date): string {
  return d.toISOString();
}

/**
 * Parses an ISO-8601 string back into a Date. Throws if the input does
 * not parse — silent `Invalid Date` returns lead to subtle bugs.
 */
export function fromIso(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`time.fromIso: invalid ISO-8601 string: ${s}`);
  }
  return d;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = MS_PER_MINUTE * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MS_PER_MINUTE);
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * MS_PER_HOUR);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}
