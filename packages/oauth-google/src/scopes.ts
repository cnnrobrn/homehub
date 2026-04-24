/**
 * Google OAuth scope constants.
 *
 * Scopes are grouped by provider. The Gmail set is derived from
 * `email_categories` — not every category needs `gmail.modify`, and
 * least-privilege matters for a reviewable consent screen.
 *
 * Current gmail categories: 'receipt' | 'reservation' | 'bill' | 'invite'
 * | 'shipping'. The adapter applies a label (`HomeHub/Ingested`) to
 * processed threads, which requires `gmail.modify`. Read + label cover
 * every current use case; we do NOT request `gmail.send` or
 * `gmail.compose`.
 *
 * `openid email` are always requested — we need the id_token `sub` to key
 * `sync.google_connection` and the email to display in the UI.
 */

export const GOOGLE_BASE_SCOPES = ['openid', 'email', 'profile'] as const;

export const GOOGLE_CALENDAR_SCOPES = [
  ...GOOGLE_BASE_SCOPES,
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
] as const;

/**
 * Gmail scope matrix. All categories need read + label-management
 * (`gmail.modify` is the narrowest scope that permits adding labels).
 * We declare the set once here; `scopesForGmail` is the accessor callers
 * use so a future category with different needs can diverge cleanly.
 */
const GMAIL_MODIFY_SCOPES = [
  ...GOOGLE_BASE_SCOPES,
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
] as const;

/** Compute the scope list for a gmail connection given opted-in categories. */
export function scopesForGmail(categories: readonly string[]): string[] {
  if (categories.length === 0) {
    throw new Error('scopesForGmail: at least one category required');
  }
  // All current categories share the same scope set. Dedup via Set in
  // case this expands to per-category differentiation later.
  return Array.from(new Set(GMAIL_MODIFY_SCOPES));
}

export function scopesForCalendar(): string[] {
  return Array.from(new Set(GOOGLE_CALENDAR_SCOPES));
}
