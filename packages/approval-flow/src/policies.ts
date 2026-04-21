/**
 * Approval policies per suggestion kind.
 *
 * A policy captures three things:
 *
 *   1. `requiresQuorum` — how many distinct member approvals must land
 *      before the action can be dispatched. Defaults to 1 (single-
 *      approver).
 *   2. `autoApproveWhen` — an optional predicate evaluated on suggestion
 *      insert. If it returns true, the worker approves the suggestion
 *      without waiting for a human tap (writing an `actor_member_id=null`
 *      approval with `audit.event` action `suggestion.auto_approved`).
 *   3. `hashCanonical` — the function that hashes the preview for
 *      tamper detection. All defaults use `canonicalHash`; specific
 *      kinds can override if they need a bespoke representation.
 *
 * Auto-approval deny-list: `cancel_subscription`, `propose_transfer`,
 * and `settle_shared_expense` are destructive. Their policy NEVER
 * returns an auto-approver even if the household has enabled the kind
 * in `household.settings.approval.auto_approve_kinds`. The check is
 * centralized in `getPolicyFor` so no caller can accidentally wire in
 * an auto-approval for a destructive kind.
 */

import { canonicalHash, type CanonicalHashInput } from './canonical-hash.js';
import { type SuggestionRow } from './types.js';

/**
 * Subset of `household.settings` the policy lookup cares about.
 *
 * Shape (as it will land in `app.household.settings`):
 *
 *   {
 *     approval: {
 *       auto_approve_kinds: ['outing_idea', 'meal_swap']
 *     }
 *   }
 *
 * Absent or malformed values are treated as "no auto-approval enabled".
 */
export interface ApprovalSettings {
  approval?: {
    auto_approve_kinds?: string[];
  };
}

/**
 * Context passed to `autoApproveWhen`. Policies may inspect the raw
 * suggestion row and any household settings they need.
 */
export interface PolicyEvaluationContext {
  settings?: ApprovalSettings;
  /** Current time, injected for deterministic tests. */
  now?: Date;
}

export interface ApprovalPolicy {
  kind: string;
  requiresQuorum: number;
  autoApproveWhen?: (suggestion: SuggestionRow, ctx: PolicyEvaluationContext) => boolean;
  hashCanonical: (suggestion: Pick<SuggestionRow, 'preview' | 'kind' | 'household_id'>) => string;
}

/**
 * Kinds the system will NEVER auto-approve regardless of household
 * settings. Any attempt to list these in `auto_approve_kinds` is
 * silently ignored (and logged at the call site).
 */
export const AUTO_APPROVAL_DENY_LIST: ReadonlySet<string> = new Set([
  'cancel_subscription',
  'propose_transfer',
  'settle_shared_expense',
  'transfer_funds',
]);

function defaultHashCanonical(
  suggestion: Pick<SuggestionRow, 'preview' | 'kind' | 'household_id'>,
): string {
  const input: CanonicalHashInput = {
    kind: suggestion.kind,
    household_id: suggestion.household_id,
    preview: suggestion.preview,
  };
  return canonicalHash(input);
}

function basePolicy(kind: string, requiresQuorum = 1): ApprovalPolicy {
  return {
    kind,
    requiresQuorum,
    hashCanonical: defaultHashCanonical,
  };
}

/**
 * The starter policy set. Additions here are the contract consumers
 * rely on; removals are breaking.
 */
export const DEFAULT_POLICIES: Record<string, ApprovalPolicy> = {
  // Fun / outing / trip.
  outing_idea: basePolicy('outing_idea'),
  trip_prep: basePolicy('trip_prep'),
  book_reservation: basePolicy('book_reservation'),
  propose_book_reservation: basePolicy('propose_book_reservation'),

  // Food.
  meal_swap: basePolicy('meal_swap'),
  grocery_order: basePolicy('grocery_order'),
  generate_grocery_order: basePolicy('generate_grocery_order'),
  new_dish: basePolicy('new_dish'),
  new_dish_for_variety: basePolicy('new_dish_for_variety'),

  // Social.
  reach_out: basePolicy('reach_out'),
  gift_idea: basePolicy('gift_idea'),
  host_back: basePolicy('host_back'),

  // Financial — destructive kinds. `cancel_subscription` is marked
  // undispatchable-by-auto-approval via the deny list above.
  cancel_subscription: basePolicy('cancel_subscription'),
  transfer_funds: basePolicy('transfer_funds'),
  propose_transfer: basePolicy('propose_transfer'),
  settle_shared_expense: basePolicy('settle_shared_expense'),
  rebalance_budget: basePolicy('rebalance_budget'),

  // Calendar / message drafts from chat.
  add_to_calendar: basePolicy('add_to_calendar'),
  propose_add_to_calendar: basePolicy('propose_add_to_calendar'),
  draft_message: basePolicy('draft_message'),
  send_message: basePolicy('send_message'),
};

/**
 * Returns the policy for a given kind, layering household settings on
 * top of the base policy.
 *
 * - If the kind is unknown, returns a sensible default (quorum=1, no
 *   auto-approval). This means an unknown kind never auto-approves,
 *   which is the safe default.
 * - If the kind appears in `settings.approval.auto_approve_kinds` AND
 *   is NOT in `AUTO_APPROVAL_DENY_LIST`, adds an `autoApproveWhen` that
 *   returns true unconditionally.
 */
export function getPolicyFor(kind: string, settings?: ApprovalSettings): ApprovalPolicy {
  const base = DEFAULT_POLICIES[kind] ?? basePolicy(kind);

  const enabledKinds = settings?.approval?.auto_approve_kinds ?? [];
  const shouldAutoApprove = enabledKinds.includes(kind) && !AUTO_APPROVAL_DENY_LIST.has(kind);

  if (shouldAutoApprove) {
    return {
      ...base,
      autoApproveWhen: () => true,
    };
  }
  return base;
}
