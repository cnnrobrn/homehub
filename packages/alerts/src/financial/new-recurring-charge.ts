/**
 * `new_recurring_charge` detector.
 *
 * Spec: `specs/06-segments/financial/summaries-alerts.md` — "First
 * detected instance of a new repeating pattern".
 *
 * This detector is a thin wrapper: the subscription detector (see
 * `../subscription-detector.ts`) is the one that discovers new patterns.
 * When a subscription node is freshly created we emit an `info` alert
 * so the UI surfaces "we started tracking this subscription".
 *
 * Dedupe key: `${subscriptionNodeId}`.
 */

import { type SubscriptionNode, type AlertEmission } from '../types.js';

export interface NewRecurringChargeInput {
  householdId: string;
  /**
   * Subscription nodes created in this alerts run (the caller scopes
   * this — usually everything newly-inserted by the subscription
   * detector, which runs first).
   */
  newlyCreated: SubscriptionNode[];
}

export function detectNewRecurringCharge(input: NewRecurringChargeInput): AlertEmission[] {
  const out: AlertEmission[] = [];
  for (const sub of input.newlyCreated) {
    if (sub.household_id !== input.householdId) continue;
    const metadata = sub.metadata ?? {};
    const priceCents = typeof metadata.price_cents === 'number' ? metadata.price_cents : null;
    const cadence = typeof metadata.cadence === 'string' ? metadata.cadence : 'recurring';
    const priceStr = priceCents !== null ? ` at ${formatCents(priceCents)}` : '';
    out.push({
      segment: 'financial',
      severity: 'info',
      kind: 'new_recurring_charge',
      dedupeKey: sub.id,
      title: `New recurring charge: ${sub.canonical_name}`,
      body: `HomeHub detected a new ${cadence} charge from ${sub.canonical_name}${priceStr}.`,
      context: {
        subscription_node_id: sub.id,
        canonical_name: sub.canonical_name,
        cadence,
        price_cents: priceCents,
      },
    });
  }
  return out;
}

function formatCents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}
