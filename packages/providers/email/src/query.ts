/**
 * Gmail search-query composition.
 *
 * Maps a member's opted-in categories to a Gmail search string. The
 * design goal: produce a filter narrow enough to keep ingest volume
 * low, but transparent enough that the settings UI can show the member
 * exactly what we'll scan (see `EmailConnectDialog`).
 *
 * Filter lives are kept intentionally short so they read on one line in
 * the preview dialog; we can tune them as false-positives surface. The
 * `withinDays` window maps to the 180-day initial-sync bound from the
 * `google-workspace.md` spec.
 */

import type { EmailCategory } from './types.js';

export interface CategoryFilter {
  category: EmailCategory;
  /**
   * The Gmail search snippet added to the composed query. Uses `()` to
   * group subject/keyword OR-s so the outer composition stays simple.
   */
  query: string;
  /** Short human-readable description shown in the privacy-preview dialog. */
  description: string;
}

/**
 * Spec: "What we ingest" in `specs/03-integrations/google-workspace.md`.
 * Each filter is a conservative keyword set; the per-category extraction
 * worker in M4-B refines with a classifier.
 */
export const CATEGORY_FILTERS: Record<EmailCategory, CategoryFilter> = {
  receipt: {
    category: 'receipt',
    query:
      '(subject:(receipt OR "order confirmation" OR "your order" OR paid OR purchase) OR from:(receipts OR billing OR orders))',
    description: 'Receipts & order confirmations',
  },
  reservation: {
    category: 'reservation',
    query:
      '(subject:(reservation OR booking OR itinerary OR confirmation) OR from:(opentable.com OR resy.com OR airbnb.com OR booking.com OR hotels.com OR marriott.com OR hilton.com))',
    description: 'Restaurant, travel, and lodging reservations',
  },
  bill: {
    category: 'bill',
    query:
      '(subject:(bill OR statement OR invoice OR "amount due" OR autopay) OR from:(billing OR statements))',
    description: 'Bills & statements',
  },
  invite: {
    category: 'invite',
    query: '(has:attachment filename:ics OR subject:(invitation OR "event invite"))',
    description: 'Calendar invites (.ics)',
  },
  shipping: {
    category: 'shipping',
    query:
      '(subject:(shipped OR "tracking number" OR "out for delivery" OR delivered) OR from:(shipment-tracking OR noreply@amazon OR auto-confirm@amazon OR ups.com OR fedex.com OR usps.com))',
    description: 'Shipping & delivery notifications',
  },
};

/** Valid category strings — used by the web-app connect route to validate. */
export function isEmailCategory(value: string): value is EmailCategory {
  return value in CATEGORY_FILTERS;
}

export interface BuildQueryArgs {
  categories: readonly EmailCategory[];
  /** e.g. 180 → `newer_than:180d`. Omitted if undefined. */
  withinDays?: number;
  /** Force `in:inbox` so we don't crawl archived mail. Default true. */
  inboxOnly?: boolean;
  /**
   * When true (default), append `-label:HomeHub/Ingested` so a subsequent
   * full-sync skips anything we've already labeled. The worker still
   * does idempotent upserts, but this keeps the proxy volume low.
   */
  excludeIngested?: boolean;
}

/**
 * Compose a Gmail `q=` string.
 *
 * Example:
 *   buildGmailQuery({ categories: ['receipt', 'shipping'], withinDays: 180 })
 *   => 'in:inbox newer_than:180d -label:HomeHub/Ingested (…receipt…) OR (…shipping…)'
 *
 * No categories → an empty string; callers should refuse to enqueue in
 * that case (no opt-in → nothing to scan).
 */
export function buildGmailQuery(args: BuildQueryArgs): string {
  if (args.categories.length === 0) return '';
  const parts: string[] = [];
  if (args.inboxOnly !== false) parts.push('in:inbox');
  if (args.withinDays && args.withinDays > 0) parts.push(`newer_than:${args.withinDays}d`);
  if (args.excludeIngested !== false) parts.push('-label:HomeHub/Ingested');
  const categoryGroup = args.categories
    .map((c) => CATEGORY_FILTERS[c]?.query)
    .filter(Boolean)
    .join(' OR ');
  if (categoryGroup) parts.push(`(${categoryGroup})`);
  return parts.join(' ');
}

/**
 * Produce the human-readable sentence list of what the composed query
 * will match. Shown in the settings preview dialog so the member sees
 * exactly what we will scan before consenting to the OAuth grant.
 */
export function describeCategories(categories: readonly EmailCategory[]): string[] {
  return categories.map((c) => CATEGORY_FILTERS[c].description);
}
