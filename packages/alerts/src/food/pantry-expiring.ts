/**
 * `pantry_expiring` detector.
 *
 * Spec: `specs/06-segments/food/*`. Emits a `warn` alert for every
 * `app.pantry_item` whose `expires_on` falls within the next
 * `PANTRY_EXPIRING_DAYS` days (inclusive).
 *
 * Dedupe key: `${pantryItemId}-${expiresOn}` so repeatedly running the
 * detector doesn't re-emit the same alert, but a member updating the
 * expiry date produces a fresh alert.
 */

import { type AlertEmission } from '../types.js';

import { type PantryItemRow } from './types.js';

export const PANTRY_EXPIRING_DAYS = 3;

export interface PantryExpiringInput {
  householdId: string;
  items: PantryItemRow[];
  now: Date;
}

export function detectPantryExpiring(input: PantryExpiringInput): AlertEmission[] {
  const horizonMs = PANTRY_EXPIRING_DAYS * 24 * 60 * 60 * 1000;
  const nowMs = input.now.getTime();
  const windowEnd = nowMs + horizonMs;

  const out: AlertEmission[] = [];
  for (const item of input.items) {
    if (item.household_id !== input.householdId) continue;
    if (!item.expires_on) continue;
    const expiryMs = Date.parse(`${item.expires_on}T00:00:00.000Z`);
    if (!Number.isFinite(expiryMs)) continue;
    if (expiryMs > windowEnd) continue;

    const daysUntil = Math.round((expiryMs - nowMs) / (24 * 60 * 60 * 1000));
    const phrasing =
      daysUntil < 0
        ? `expired ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago`
        : daysUntil === 0
          ? 'expires today'
          : daysUntil === 1
            ? 'expires tomorrow'
            : `expires in ${daysUntil} days`;

    out.push({
      segment: 'food',
      severity: 'warn',
      kind: 'pantry_expiring',
      dedupeKey: `${item.id}-${item.expires_on}`,
      title: `${item.name} ${phrasing}`,
      body: `${item.name} in your pantry ${phrasing}. Use it in a meal this week or compost it before it spoils.`,
      context: {
        pantry_item_id: item.id,
        name: item.name,
        expires_on: item.expires_on,
        days_until_expiry: daysUntil,
        location: item.location,
      },
    });
  }
  return out;
}
