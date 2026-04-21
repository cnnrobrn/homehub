/**
 * Server actions for the Food segment UI.
 *
 * - Meal planner CRUD (`upsertMeal`, `deleteMeal`).
 * - Pantry CRUD (`upsertPantryItem`, `deletePantryItem`).
 * - Grocery-draft approve/reject (`approveGroceryDraftAction`,
 *   `rejectGroceryDraftAction`). Approval materializes the
 *   suggestion's `preview.items` into an `app.grocery_list` draft; the
 *   provider-side order placement lives in M9.
 *
 * Every action Zod-validates, catches into the shared `ActionResult`
 * envelope, and writes an `audit.event` row.
 */

'use server';

import {
  UnauthorizedError,
  ValidationError,
  createServiceClient,
  getUser,
  resolveMemberId,
  writeAuditEvent,
} from '@homehub/auth-server';
import { z } from 'zod';

import { type ActionResult, ok, toErr } from './_envelope';

import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';


type ServiceClient = ReturnType<typeof createServiceClient>;

interface AuthedActor {
  userId: string;
  userEmail: string | null;
  householdId: string;
  memberId: string;
  service: ServiceClient;
}

async function requireMemberForHousehold(householdId: string): Promise<AuthedActor> {
  const env = authEnv();
  const cookies = await nextCookieAdapter();
  const user = await getUser(env, cookies);
  if (!user) throw new UnauthorizedError('no session');
  const service = createServiceClient(env);
  const memberId = await resolveMemberId(service, householdId, user.id);
  if (!memberId) throw new UnauthorizedError('not a member of this household');
  return {
    userId: user.id,
    userEmail: user.email,
    householdId,
    memberId,
    service,
  };
}

// ==========================================================================
// upsertMealAction
// ==========================================================================

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const upsertMealSchema = z.object({
  householdId: z.string().uuid(),
  mealId: z.string().uuid().optional(),
  date: isoDate,
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  title: z.string().min(1).max(200),
  dishNodeId: z.string().uuid().nullable().optional(),
  cookMemberId: z.string().uuid().nullable().optional(),
  servings: z.number().int().positive().nullable().optional(),
  status: z.enum(['planned', 'cooking', 'served', 'skipped']).optional(),
  notes: z.string().max(1_000).nullable().optional(),
});

export async function upsertMealAction(
  input: z.input<typeof upsertMealSchema>,
): Promise<ActionResult<{ mealId: string }>> {
  try {
    const parsed = upsertMealSchema.parse(input);
    const actor = await requireMemberForHousehold(parsed.householdId);
    const patch = {
      household_id: actor.householdId,
      planned_for: parsed.date,
      slot: parsed.slot,
      title: parsed.title,
      dish_node_id: parsed.dishNodeId ?? null,
      cook_member_id: parsed.cookMemberId ?? null,
      servings: parsed.servings ?? null,
      status: parsed.status ?? 'planned',
      notes: parsed.notes ?? null,
    };
    let mealId = parsed.mealId ?? null;
    if (mealId) {
      const { error } = await actor.service
        .schema('app')
        .from('meal')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', mealId)
        .eq('household_id', actor.householdId);
      if (error) throw new Error(`upsertMealAction update: ${error.message}`);
    } else {
      const { data, error } = await actor.service
        .schema('app')
        .from('meal')
        .insert(patch)
        .select('id')
        .single();
      if (error || !data) throw new Error(`upsertMealAction insert: ${error?.message ?? 'no id'}`);
      mealId = data.id as string;
    }
    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: parsed.mealId ? 'app.meal.updated' : 'app.meal.created',
      resource_type: 'app.meal',
      resource_id: mealId,
      after: patch,
    });
    return ok({ mealId });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// deleteMealAction
// ==========================================================================

const deleteMealSchema = z.object({
  householdId: z.string().uuid(),
  mealId: z.string().uuid(),
});

export async function deleteMealAction(
  input: z.input<typeof deleteMealSchema>,
): Promise<ActionResult<{ mealId: string }>> {
  try {
    const parsed = deleteMealSchema.parse(input);
    const actor = await requireMemberForHousehold(parsed.householdId);
    const { error } = await actor.service
      .schema('app')
      .from('meal')
      .delete()
      .eq('id', parsed.mealId)
      .eq('household_id', actor.householdId);
    if (error) throw new Error(`deleteMealAction: ${error.message}`);
    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'app.meal.deleted',
      resource_type: 'app.meal',
      resource_id: parsed.mealId,
    });
    return ok({ mealId: parsed.mealId });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// upsertPantryItemAction
// ==========================================================================

const upsertPantrySchema = z.object({
  householdId: z.string().uuid(),
  pantryItemId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  expiresOn: isoDate.nullable().optional(),
  location: z.enum(['fridge', 'freezer', 'pantry']).nullable().optional(),
});

export async function upsertPantryItemAction(
  input: z.input<typeof upsertPantrySchema>,
): Promise<ActionResult<{ pantryItemId: string }>> {
  try {
    const parsed = upsertPantrySchema.parse(input);
    const actor = await requireMemberForHousehold(parsed.householdId);
    const patch = {
      household_id: actor.householdId,
      name: parsed.name,
      quantity: parsed.quantity ?? null,
      unit: parsed.unit ?? null,
      expires_on: parsed.expiresOn ?? null,
      location: parsed.location ?? null,
      last_seen_at: new Date().toISOString(),
    };
    let pantryItemId = parsed.pantryItemId ?? null;
    if (pantryItemId) {
      const { error } = await actor.service
        .schema('app')
        .from('pantry_item')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', pantryItemId)
        .eq('household_id', actor.householdId);
      if (error) throw new Error(`upsertPantryItemAction update: ${error.message}`);
    } else {
      const { data, error } = await actor.service
        .schema('app')
        .from('pantry_item')
        .insert(patch)
        .select('id')
        .single();
      if (error || !data) {
        throw new Error(`upsertPantryItemAction insert: ${error?.message ?? 'no id'}`);
      }
      pantryItemId = data.id as string;
    }
    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: parsed.pantryItemId ? 'app.pantry_item.updated' : 'app.pantry_item.created',
      resource_type: 'app.pantry_item',
      resource_id: pantryItemId,
      after: patch,
    });
    return ok({ pantryItemId });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// deletePantryItemAction
// ==========================================================================

const deletePantrySchema = z.object({
  householdId: z.string().uuid(),
  pantryItemId: z.string().uuid(),
});

export async function deletePantryItemAction(
  input: z.input<typeof deletePantrySchema>,
): Promise<ActionResult<{ pantryItemId: string }>> {
  try {
    const parsed = deletePantrySchema.parse(input);
    const actor = await requireMemberForHousehold(parsed.householdId);
    const { error } = await actor.service
      .schema('app')
      .from('pantry_item')
      .delete()
      .eq('id', parsed.pantryItemId)
      .eq('household_id', actor.householdId);
    if (error) throw new Error(`deletePantryItemAction: ${error.message}`);
    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'app.pantry_item.deleted',
      resource_type: 'app.pantry_item',
      resource_id: parsed.pantryItemId,
    });
    return ok({ pantryItemId: parsed.pantryItemId });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// approveGroceryDraftAction — materializes a propose_grocery_order
// suggestion into an app.grocery_list draft.
// ==========================================================================

interface SuggestionShape {
  id: string;
  household_id: string;
  segment: string;
  kind: string;
  status: string;
  preview: Record<string, unknown> | null;
}

const approveGrocerySchema = z.object({
  suggestionId: z.string().uuid(),
});

export async function approveGroceryDraftAction(
  input: z.input<typeof approveGrocerySchema>,
): Promise<ActionResult<{ groceryListId: string }>> {
  try {
    const parsed = approveGrocerySchema.parse(input);
    const env = authEnv();
    const service = createServiceClient(env);
    const { data: sugRow, error: sugErr } = await service
      .schema('app')
      .from('suggestion')
      .select('id, household_id, segment, kind, status, preview')
      .eq('id', parsed.suggestionId)
      .maybeSingle();
    if (sugErr) throw new Error(`approveGroceryDraftAction: ${sugErr.message}`);
    if (!sugRow) {
      throw new ValidationError('suggestion not found', [
        { path: 'suggestionId', message: 'suggestion not found' },
      ]);
    }
    const sug = sugRow as SuggestionShape;
    if (sug.segment !== 'food' || sug.kind !== 'propose_grocery_order') {
      throw new ValidationError('suggestion is not a grocery draft', [
        { path: 'suggestionId', message: 'expected kind=propose_grocery_order' },
      ]);
    }
    if (sug.status !== 'pending') {
      throw new ValidationError('suggestion is not pending', [
        { path: 'suggestionId', message: 'suggestion already resolved' },
      ]);
    }
    const actor = await requireMemberForHousehold(sug.household_id);

    const preview = (sug.preview as { planned_for?: unknown; items?: unknown }) ?? {};
    const plannedFor = typeof preview.planned_for === 'string' ? preview.planned_for : null;
    const items = Array.isArray(preview.items)
      ? (preview.items as Array<Record<string, unknown>>)
      : [];

    const { data: listInserted, error: listErr } = await actor.service
      .schema('app')
      .from('grocery_list')
      .insert({
        household_id: actor.householdId,
        planned_for: plannedFor,
        status: 'draft',
        provider: 'suggestion_approval',
      })
      .select('id')
      .single();
    if (listErr || !listInserted) {
      throw new Error(`approveGroceryDraftAction list insert: ${listErr?.message ?? 'no id'}`);
    }
    const listId = listInserted.id as string;
    if (items.length > 0) {
      const rows = items.map((i) => ({
        list_id: listId,
        household_id: actor.householdId,
        name: typeof i.name === 'string' ? i.name : 'Unknown',
        quantity: typeof i.quantity === 'number' ? i.quantity : null,
        unit: typeof i.unit === 'string' ? i.unit : null,
        checked: false,
      }));
      const { error: itemErr } = await actor.service
        .schema('app')
        .from('grocery_list_item')
        .insert(rows);
      if (itemErr) {
        throw new Error(`approveGroceryDraftAction item insert: ${itemErr.message}`);
      }
    }
    const resolvedAt = new Date().toISOString();
    await actor.service
      .schema('app')
      .from('suggestion')
      .update({
        status: 'approved',
        resolved_at: resolvedAt,
        resolved_by: actor.memberId,
      })
      .eq('id', sug.id);
    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'app.suggestion.approved',
      resource_type: 'app.suggestion',
      resource_id: sug.id,
      after: { kind: 'propose_grocery_order', grocery_list_id: listId },
    });
    return ok({ groceryListId: listId });
  } catch (err) {
    return toErr(err);
  }
}

// ==========================================================================
// rejectGroceryDraftAction
// ==========================================================================

const rejectGrocerySchema = z.object({
  suggestionId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function rejectGroceryDraftAction(
  input: z.input<typeof rejectGrocerySchema>,
): Promise<ActionResult<{ suggestionId: string }>> {
  try {
    const parsed = rejectGrocerySchema.parse(input);
    const env = authEnv();
    const service = createServiceClient(env);
    const { data: sugRow, error: sugErr } = await service
      .schema('app')
      .from('suggestion')
      .select('id, household_id, segment, kind, status')
      .eq('id', parsed.suggestionId)
      .maybeSingle();
    if (sugErr) throw new Error(`rejectGroceryDraftAction: ${sugErr.message}`);
    if (!sugRow) {
      throw new ValidationError('suggestion not found', [
        { path: 'suggestionId', message: 'suggestion not found' },
      ]);
    }
    const sug = sugRow as {
      id: string;
      household_id: string;
      segment: string;
      kind: string;
      status: string;
    };
    if (sug.segment !== 'food') {
      throw new ValidationError('not a food suggestion', [
        { path: 'suggestionId', message: 'expected segment=food' },
      ]);
    }
    const actor = await requireMemberForHousehold(sug.household_id);
    const resolvedAt = new Date().toISOString();
    await actor.service
      .schema('app')
      .from('suggestion')
      .update({
        status: 'rejected',
        resolved_at: resolvedAt,
        resolved_by: actor.memberId,
      })
      .eq('id', sug.id);
    await writeAuditEvent(actor.service, {
      household_id: actor.householdId,
      actor_user_id: actor.userId,
      action: 'app.suggestion.rejected',
      resource_type: 'app.suggestion',
      resource_id: sug.id,
      after: { kind: sug.kind, reason: parsed.reason ?? null },
    });
    return ok({ suggestionId: sug.id });
  } catch (err) {
    return toErr(err);
  }
}
