/**
 * `@homehub/action-executors` — public surface.
 *
 * One executor per draft-write action kind the chat agent can propose.
 * The action-executor worker calls `registerAllExecutors` once at
 * startup with the shared provider adapters + Supabase client; every
 * executor then picks its own deps from the dep bag and registers
 * against the worker's executor registry by kind.
 *
 * The worker's registry is defined in
 * `apps/workers/action-executor/src/registry.ts` and is not imported
 * here — we take `registerExecutor` as a parameter to keep this
 * package from depending on the worker app.
 */

import { type CalendarProvider } from '@homehub/providers-calendar';
import { type EmailProvider } from '@homehub/providers-email';
import { type GroceryProvider } from '@homehub/providers-grocery';
import { type ServiceSupabaseClient } from '@homehub/worker-runtime';

import { createAddToCalendarExecutor } from './calendar/addToCalendar.js';
import { createDraftMessageExecutor } from './email/draftMessage.js';
import { createProposeBookReservationExecutor } from './email/proposeBookReservation.js';
import { createCancelSubscriptionExecutor } from './financial/cancelSubscription.js';
import { createProposeTransferExecutor } from './financial/proposeTransfer.js';
import { createSettleSharedExpenseExecutor } from './financial/settleSharedExpense.js';
import { createDraftMealPlanExecutor } from './food/draftMealPlan.js';
import { createProposeGroceryOrderExecutor } from './food/proposeGroceryOrder.js';
import { createOutingIdeaExecutor } from './fun/outingIdea.js';
import { createForgetFactExecutor } from './memory/forgetFact.js';
import { createSupersedeFactExecutor } from './memory/supersedeFact.js';
import { createGiftIdeaExecutor } from './social/giftIdea.js';
import { createHostBackExecutor } from './social/hostBack.js';
import { createReachOutExecutor } from './social/reachOut.js';
import { type ActionExecutor as WorkerActionExecutor } from './types.js';

export { PermanentExecutorError, TransientExecutorError, toPayloadInvalidError } from './errors.js';

export { resolveConnection, type ResolvedConnection } from './resolveConnection.js';

export {
  type ActionExecutor,
  type ExecutorDeps,
  type ExecutorInput,
  type ExecutorOutput,
} from './types.js';

// --- Per-kind factories ---------------------------------------------------

export {
  addToCalendarPayloadSchema,
  createAddToCalendarExecutor,
  type AddToCalendarPayload,
} from './calendar/addToCalendar.js';

export {
  createDraftMessageExecutor,
  draftMessagePayloadSchema,
  type DraftMessagePayload,
} from './email/draftMessage.js';

export {
  createProposeBookReservationExecutor,
  proposeBookReservationPayloadSchema,
  type ProposeBookReservationPayload,
} from './email/proposeBookReservation.js';

export {
  createDraftMealPlanExecutor,
  draftMealPlanPayloadSchema,
  type DraftMealPlanPayload,
} from './food/draftMealPlan.js';

export {
  createProposeGroceryOrderExecutor,
  proposeGroceryOrderPayloadSchema,
  type ProposeGroceryOrderPayload,
} from './food/proposeGroceryOrder.js';

export {
  createSupersedeFactExecutor,
  supersedeFactPayloadSchema,
  type SupersedeFactPayload,
} from './memory/supersedeFact.js';

export {
  createForgetFactExecutor,
  forgetFactPayloadSchema,
  type ForgetFactPayload,
} from './memory/forgetFact.js';

export {
  createReachOutExecutor,
  reachOutPayloadSchema,
  type ReachOutPayload,
} from './social/reachOut.js';

export {
  createGiftIdeaExecutor,
  giftIdeaPayloadSchema,
  type GiftIdeaPayload,
} from './social/giftIdea.js';

export {
  createHostBackExecutor,
  hostBackPayloadSchema,
  type HostBackPayload,
} from './social/hostBack.js';

export {
  cancelSubscriptionPayloadSchema,
  createCancelSubscriptionExecutor,
  type CancelSubscriptionPayload,
} from './financial/cancelSubscription.js';

export {
  createProposeTransferExecutor,
  proposeTransferPayloadSchema,
  type ProposeTransferPayload,
} from './financial/proposeTransfer.js';

export {
  createSettleSharedExpenseExecutor,
  settleSharedExpensePayloadSchema,
  type SettleSharedExpensePayload,
} from './financial/settleSharedExpense.js';

export {
  createOutingIdeaExecutor,
  outingIdeaPayloadSchema,
  type OutingIdeaPayload,
} from './fun/outingIdea.js';

// --- Bulk registrar -------------------------------------------------------

/**
 * Shape the worker's `registerExecutor` must satisfy. Kept loose so we
 * don't depend on the worker-side types — the worker's
 * `registry.ts#ActionExecutor` is structurally compatible.
 */
export type RegisterExecutorFn = (kind: string, handler: WorkerActionExecutor) => void;

/**
 * Deps required to construct every executor. Individual executors
 * only touch the subset they need, but passing the full bag keeps the
 * worker's bootstrap code small.
 */
export interface RegisterAllExecutorsDeps {
  supabase: ServiceSupabaseClient;
  calendar: CalendarProvider;
  email: EmailProvider;
  grocery: GroceryProvider;
  now?: () => Date;
}

/**
 * Catalog of every kind this package registers. Exposed as a constant
 * so downstream tests + ops tooling can assert parity without
 * reaching into the registry.
 *
 * Order is stable; ops dashboards can use it as the canonical kind
 * list.
 */
export const REGISTERED_KINDS = [
  // Calendar.
  'add_to_calendar',
  'propose_add_to_calendar',
  // Email / messaging drafts.
  'draft_message',
  'propose_book_reservation',
  // Food.
  'draft_meal_plan',
  'propose_grocery_order',
  // Memory edits.
  'supersede_fact',
  'forget_fact',
  // Social.
  'reach_out',
  'gift_idea',
  'host_back',
  // Financial (all destructive; never auto-approved).
  'cancel_subscription',
  'propose_transfer',
  'settle_shared_expense',
  // Fun.
  'outing_idea',
] as const;

export type RegisteredKind = (typeof REGISTERED_KINDS)[number];

/**
 * Register every executor this package ships against the worker's
 * kind-keyed registry. Call once at worker startup, after constructing
 * the provider adapters + Supabase client.
 *
 * Idempotency: `registerExecutor` throws on duplicate registration, so
 * the caller must not call this twice. The worker's `main.ts` calls it
 * exactly once before the claim loops start.
 */
export function registerAllExecutors(
  register: RegisterExecutorFn,
  deps: RegisterAllExecutorsDeps,
): void {
  const now = deps.now ?? (() => new Date());

  const addToCalendar = createAddToCalendarExecutor({
    calendar: deps.calendar,
    supabase: deps.supabase,
  });
  // The spec's naming quirk: `propose_add_to_calendar` and
  // `add_to_calendar` resolve to the same executor.
  register('add_to_calendar', addToCalendar);
  register('propose_add_to_calendar', addToCalendar);

  register(
    'draft_message',
    createDraftMessageExecutor({ email: deps.email, supabase: deps.supabase }),
  );
  register(
    'propose_book_reservation',
    createProposeBookReservationExecutor({
      email: deps.email,
      supabase: deps.supabase,
    }),
  );

  register('draft_meal_plan', createDraftMealPlanExecutor({ supabase: deps.supabase, now }));
  register(
    'propose_grocery_order',
    createProposeGroceryOrderExecutor({
      grocery: deps.grocery,
      supabase: deps.supabase,
    }),
  );

  register('supersede_fact', createSupersedeFactExecutor({ supabase: deps.supabase, now }));
  register('forget_fact', createForgetFactExecutor({ supabase: deps.supabase, now }));

  register('reach_out', createReachOutExecutor({ email: deps.email, supabase: deps.supabase }));
  register('gift_idea', createGiftIdeaExecutor({ supabase: deps.supabase, now }));
  register(
    'host_back',
    createHostBackExecutor({
      supabase: deps.supabase,
      calendar: deps.calendar,
      now,
    }),
  );

  register(
    'cancel_subscription',
    createCancelSubscriptionExecutor({
      email: deps.email,
      supabase: deps.supabase,
    }),
  );
  register('propose_transfer', createProposeTransferExecutor({ supabase: deps.supabase, now }));
  register(
    'settle_shared_expense',
    createSettleSharedExpenseExecutor({
      email: deps.email,
      supabase: deps.supabase,
      now,
    }),
  );

  register(
    'outing_idea',
    createOutingIdeaExecutor({
      calendar: deps.calendar,
      supabase: deps.supabase,
    }),
  );
}
