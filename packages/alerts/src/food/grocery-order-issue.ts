/**
 * `grocery_order_issue` detector.
 *
 * Emits a `warn` alert for every `app.grocery_list` row whose
 * `status = 'cancelled'` and was updated in the last 24h. This captures
 * the case where an Instacart order failed, a member cancelled, or a
 * draft got rejected — any of these leaves the household short for the
 * week.
 *
 * Dedupe key: `${groceryListId}` so a single cancellation does not
 * re-alert per cron tick.
 */

import { type AlertEmission } from '../types.js';

import { type GroceryListRow } from './types.js';

export const GROCERY_ORDER_ISSUE_LOOKBACK_HOURS = 24;

export interface GroceryOrderIssueInput {
  householdId: string;
  lists: GroceryListRow[];
  now: Date;
}

export function detectGroceryOrderIssue(input: GroceryOrderIssueInput): AlertEmission[] {
  const cutoff = input.now.getTime() - GROCERY_ORDER_ISSUE_LOOKBACK_HOURS * 60 * 60 * 1000;
  const out: AlertEmission[] = [];
  for (const list of input.lists) {
    if (list.household_id !== input.householdId) continue;
    if (list.status !== 'cancelled') continue;
    const updatedMs = Date.parse(list.updated_at);
    if (!Number.isFinite(updatedMs) || updatedMs < cutoff) continue;

    out.push({
      segment: 'food',
      severity: 'warn',
      kind: 'grocery_order_issue',
      dedupeKey: list.id,
      title: 'Grocery order cancelled',
      body: `A grocery order for your household was cancelled${list.planned_for ? ` (planned for ${list.planned_for})` : ''}. Open the groceries tab to retry or plan around the gap.`,
      context: {
        grocery_list_id: list.id,
        provider: list.provider,
        external_order_id: list.external_order_id,
        planned_for: list.planned_for,
        updated_at: list.updated_at,
      },
    });
  }
  return out;
}
