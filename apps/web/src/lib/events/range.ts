/**
 * Calendar range helpers used by `/calendar` and the dashboard Today
 * strip. Everything here works in the server's local `Date` timezone and
 * returns ISO strings to feed straight into `listEvents`.
 *
 * NOTE: v1 renders calendars in the browser's local timezone. Household
 * timezone awareness is a post-M2 concern (see
 * `specs/07-frontend/pages.md` "Settings › household"). When we add it,
 * swap the `Date` constructors below for `Temporal.ZonedDateTime` and
 * thread the tz through explicitly. The rest of the code is isolated
 * behind the two exported helpers, so the blast radius is small.
 */

export type CalendarView = 'week' | 'month';
export type WeekStart = 'sunday' | 'monday';

function atStartOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function atEndOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/**
 * Return the Date at midnight of the cursor's containing week, respecting
 * the household's week-start preference. Default is Sunday.
 */
export function startOfWeek(cursor: Date, weekStart: WeekStart = 'sunday'): Date {
  const d = atStartOfDay(cursor);
  const day = d.getDay(); // 0 = Sunday … 6 = Saturday
  const offset = weekStart === 'sunday' ? day : (day + 6) % 7;
  return addDays(d, -offset);
}

export function endOfWeek(cursor: Date, weekStart: WeekStart = 'sunday'): Date {
  const start = startOfWeek(cursor, weekStart);
  return atEndOfDay(addDays(start, 6));
}

export function startOfMonth(cursor: Date): Date {
  const d = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 0, 0, 0, 0);
  return d;
}

export function endOfMonth(cursor: Date): Date {
  const d = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
  return d;
}

export function startOfToday(): Date {
  return atStartOfDay(new Date());
}

export function endOfToday(): Date {
  return atEndOfDay(new Date());
}

/**
 * Resolve the calendar window for the given view + cursor. Returns the
 * half-open `[from, to]` pair; `to` is inclusive for rendering but we
 * query with a strict less-than so the 23:59:59.999 end of day is the
 * practical upper bound.
 */
export function calendarWindow(
  view: CalendarView,
  cursor: Date,
  weekStart: WeekStart = 'sunday',
): { from: Date; to: Date } {
  if (view === 'week') {
    return { from: startOfWeek(cursor, weekStart), to: endOfWeek(cursor, weekStart) };
  }
  return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
}

/**
 * Expand a calendar window into its individual days. Used by the
 * week/month renderers to lay out columns/cells.
 */
export function daysInRange(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let cursor = atStartOfDay(from);
  const end = atStartOfDay(to);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function formatISODate(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse a `YYYY-MM-DD` cursor string into a local Date. Falls back to
 * today on invalid input — callers that care about strict validation
 * should pass through `listEventsArgsSchema` first.
 */
export function parseCursor(input: string | null | undefined): Date {
  if (!input) return startOfToday();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) return startOfToday();
  const [, y, mo, d] = m;
  const parsed = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(parsed.getTime())) return startOfToday();
  return atStartOfDay(parsed);
}

export function parseView(input: string | null | undefined): CalendarView {
  return input === 'month' ? 'month' : 'week';
}

export function parseWeekStart(input: unknown): WeekStart {
  return input === 'monday' ? 'monday' : 'sunday';
}
