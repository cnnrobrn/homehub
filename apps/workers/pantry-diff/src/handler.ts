/**
 * `pantry-diff` handler.
 *
 * For each household in scope:
 *   1. Load planned meals for the next 7 days.
 *   2. Resolve each meal's ingredient set (via the dish node's
 *      `contains` edges, or `metadata.ingredients` as a fallback).
 *   3. Subtract the current pantry inventory, normalized on lowercased
 *      name.
 *   4. Upsert an `app.grocery_list` draft for the upcoming Saturday
 *      (or the earliest unscheduled draft) with the deficit items —
 *      but only if the set differs from the previous draft so
 *      member-edited drafts are preserved.
 *
 * Idempotency: every write path uses stable keys. Re-running over the
 * same inputs is a no-op.
 */

import { type Database, type Json } from '@homehub/db';
import { type Logger } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

export const PANTRY_DIFF_HORIZON_DAYS = 7;

export interface PantryDiffDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  now?: () => Date;
  /** Scope to a subset of households. Omit for all. */
  householdIds?: string[];
}

export interface PantryDiffSummary {
  householdId: string;
  upsertedListId: string | null;
  deficitCount: number;
  skippedReason: 'no_meals' | 'no_deficits' | 'unchanged' | null;
}

interface MealRow {
  id: string;
  household_id: string;
  planned_for: string;
  slot: string;
  title: string;
  dish_node_id: string | null;
  status: string;
}

interface PantryItemRow {
  household_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
}

interface NodeMetaIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

interface EdgeRow {
  household_id: string;
  src_id: string;
  dst_id: string;
  type: string;
}

interface DishNodeRow {
  id: string;
  canonical_name: string;
  metadata: Json | null;
}

interface IngredientNodeRow {
  id: string;
  canonical_name: string;
}

interface GroceryListRow {
  id: string;
  planned_for: string | null;
  status: string;
  created_at: string;
}

interface GroceryListItemRow {
  list_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  source_meal_id: string | null;
}

export async function runPantryDiffWorker(deps: PantryDiffDeps): Promise<PantryDiffSummary[]> {
  const now = (deps.now ?? (() => new Date()))();
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const out: PantryDiffSummary[] = [];
  for (const householdId of householdIds) {
    try {
      const summary = await diffOne(deps, householdId, now);
      out.push(summary);
    } catch (err) {
      deps.log.error('pantry-diff: household run failed', {
        household_id: householdId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  deps.log.info('pantry-diff run complete', {
    households: householdIds.length,
    upserts: out.filter((s) => s.upsertedListId !== null).length,
  });
  return out;
}

async function diffOne(
  deps: PantryDiffDeps,
  householdId: string,
  now: Date,
): Promise<PantryDiffSummary> {
  const horizonMs = PANTRY_DIFF_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const fromIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  const toDate = new Date(now.getTime() + horizonMs);
  const toIso = toDate.toISOString().slice(0, 10);

  // --- 1. Upcoming meals ------------------------------------------------
  const { data: mealRows, error: mealErr } = await deps.supabase
    .schema('app')
    .from('meal')
    .select('id, household_id, planned_for, slot, title, dish_node_id, status')
    .eq('household_id', householdId)
    .gte('planned_for', fromIso)
    .lte('planned_for', toIso)
    .neq('status', 'skipped')
    .limit(200);
  if (mealErr) throw new Error(`pantry-diff meal lookup: ${mealErr.message}`);
  const meals = (mealRows ?? []) as MealRow[];
  if (meals.length === 0) {
    return {
      householdId,
      upsertedListId: null,
      deficitCount: 0,
      skippedReason: 'no_meals',
    };
  }

  // --- 2. Pantry --------------------------------------------------------
  const { data: pantryRows, error: pantryErr } = await deps.supabase
    .schema('app')
    .from('pantry_item')
    .select('household_id, name, quantity, unit')
    .eq('household_id', householdId)
    .limit(500);
  if (pantryErr) throw new Error(`pantry-diff pantry lookup: ${pantryErr.message}`);
  const pantry = (pantryRows ?? []) as PantryItemRow[];
  const pantryNames = new Set(pantry.map((p) => normalizeName(p.name)));

  // --- 3. Ingredients from dish nodes + metadata ------------------------
  const dishNodeIds = meals.map((m) => m.dish_node_id).filter((id): id is string => Boolean(id));

  const ingredientsByDish = new Map<
    string,
    Array<{ name: string; quantity: number | null; unit: string | null }>
  >();
  if (dishNodeIds.length > 0) {
    // Load dish rows to surface metadata-based ingredient lists.
    const { data: dishNodes, error: dishErr } = await deps.supabase
      .schema('mem')
      .from('node')
      .select('id, canonical_name, metadata')
      .eq('household_id', householdId)
      .in('id', dishNodeIds);
    if (dishErr) throw new Error(`pantry-diff dish lookup: ${dishErr.message}`);

    // Load contains edges.
    const { data: edgeRows, error: edgeErr } = await deps.supabase
      .schema('mem')
      .from('edge')
      .select('household_id, src_id, dst_id, type')
      .eq('household_id', householdId)
      .eq('type', 'contains')
      .in('src_id', dishNodeIds);
    if (edgeErr) throw new Error(`pantry-diff edge lookup: ${edgeErr.message}`);
    const edges = (edgeRows ?? []) as EdgeRow[];

    const ingredientIds = [...new Set(edges.map((e) => e.dst_id))];
    const { data: ingredientNodes, error: ingErr } =
      ingredientIds.length > 0
        ? await deps.supabase
            .schema('mem')
            .from('node')
            .select('id, canonical_name')
            .eq('household_id', householdId)
            .in('id', ingredientIds)
        : { data: [] as IngredientNodeRow[], error: null };
    if (ingErr) throw new Error(`pantry-diff ingredient lookup: ${ingErr.message}`);
    const ingredientNameById = new Map<string, string>();
    for (const node of (ingredientNodes ?? []) as IngredientNodeRow[]) {
      ingredientNameById.set(node.id, node.canonical_name);
    }

    for (const dish of (dishNodes ?? []) as DishNodeRow[]) {
      const bucket: Array<{ name: string; quantity: number | null; unit: string | null }> = [];
      // Pull from edges first.
      for (const edge of edges) {
        if (edge.src_id !== dish.id) continue;
        const name = ingredientNameById.get(edge.dst_id);
        if (!name) continue;
        bucket.push({ name, quantity: null, unit: null });
      }
      // Fallback: dish.metadata.ingredients array.
      const metadata = (dish.metadata as { ingredients?: unknown } | null) ?? {};
      const metaIngredients = Array.isArray(metadata.ingredients)
        ? (metadata.ingredients as NodeMetaIngredient[])
        : [];
      for (const ing of metaIngredients) {
        if (!ing?.name) continue;
        bucket.push({
          name: String(ing.name),
          quantity: typeof ing.quantity === 'number' ? ing.quantity : null,
          unit: typeof ing.unit === 'string' ? ing.unit : null,
        });
      }
      ingredientsByDish.set(dish.id, bucket);
    }
  }

  // Collapse ingredients across meals, keyed on normalized name. Keep
  // the best-available quantity/unit (first non-null wins).
  const requested = new Map<
    string,
    { displayName: string; quantity: number | null; unit: string | null; mealIds: string[] }
  >();
  for (const meal of meals) {
    const dishIngredients = meal.dish_node_id
      ? ingredientsByDish.get(meal.dish_node_id)
      : undefined;
    if (!dishIngredients || dishIngredients.length === 0) {
      // The meal has no linked dish / ingredients. We can't compute a
      // deficit for it, but we note it so the member has context.
      continue;
    }
    for (const ing of dishIngredients) {
      const key = normalizeName(ing.name);
      if (!key) continue;
      const entry = requested.get(key);
      if (entry) {
        if (entry.quantity === null && ing.quantity !== null) entry.quantity = ing.quantity;
        if (entry.unit === null && ing.unit !== null) entry.unit = ing.unit;
        entry.mealIds.push(meal.id);
      } else {
        requested.set(key, {
          displayName: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          mealIds: [meal.id],
        });
      }
    }
  }

  // --- 4. Deficit = requested \ pantry ---------------------------------
  const deficits: Array<{
    name: string;
    quantity: number | null;
    unit: string | null;
    sourceMealIds: string[];
  }> = [];
  for (const [key, entry] of requested) {
    if (pantryNames.has(key)) continue;
    deficits.push({
      name: entry.displayName,
      quantity: entry.quantity,
      unit: entry.unit,
      sourceMealIds: entry.mealIds,
    });
  }

  if (deficits.length === 0) {
    return {
      householdId,
      upsertedListId: null,
      deficitCount: 0,
      skippedReason: 'no_deficits',
    };
  }

  // --- 5. Upsert draft for the next Saturday ---------------------------
  const plannedFor = nextSaturday(now);

  // Check whether an existing draft matches what we'd write. If yes,
  // skip to preserve member edits.
  const existingDraftId = await findExistingDraftForDate(deps.supabase, householdId, plannedFor);
  if (existingDraftId) {
    const existingItems = await loadGroceryItems(deps.supabase, existingDraftId);
    if (sameDeficitSet(existingItems, deficits)) {
      return {
        householdId,
        upsertedListId: existingDraftId,
        deficitCount: deficits.length,
        skippedReason: 'unchanged',
      };
    }
    // Replace the draft rows.
    await replaceDraftItems(deps.supabase, existingDraftId, householdId, deficits);
    await writeAudit(deps.supabase, {
      household_id: householdId,
      action: 'pantry_diff.draft_updated',
      resource_id: existingDraftId,
      after: { planned_for: plannedFor, deficit_count: deficits.length },
    });
    return {
      householdId,
      upsertedListId: existingDraftId,
      deficitCount: deficits.length,
      skippedReason: null,
    };
  }

  const newListId = await createDraft(deps.supabase, householdId, plannedFor, deficits);
  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'pantry_diff.draft_created',
    resource_id: newListId,
    after: { planned_for: plannedFor, deficit_count: deficits.length },
  });

  return {
    householdId,
    upsertedListId: newListId,
    deficitCount: deficits.length,
    skippedReason: null,
  };
}

// -- helpers -----------------------------------------------------------------

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function nextSaturday(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dow = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const delta = dow === 6 ? 7 : (6 - dow + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function listHouseholds(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase.schema('app').from('household').select('id').limit(10_000);
  if (error) throw new Error(`pantry-diff household scan: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

async function findExistingDraftForDate(
  supabase: SupabaseClient<Database>,
  householdId: string,
  plannedFor: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('grocery_list')
    .select('id, planned_for, status, created_at')
    .eq('household_id', householdId)
    .eq('status', 'draft')
    .eq('planned_for', plannedFor)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<GroceryListRow>();
  if (error) throw new Error(`pantry-diff draft lookup: ${error.message}`);
  return data?.id ?? null;
}

async function loadGroceryItems(
  supabase: SupabaseClient<Database>,
  listId: string,
): Promise<GroceryListItemRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('grocery_list_item')
    .select('list_id, name, quantity, unit, source_meal_id')
    .eq('list_id', listId);
  if (error) throw new Error(`pantry-diff list items: ${error.message}`);
  return (data ?? []) as GroceryListItemRow[];
}

function sameDeficitSet(
  existing: GroceryListItemRow[],
  deficits: Array<{ name: string; quantity: number | null; unit: string | null }>,
): boolean {
  if (existing.length !== deficits.length) return false;
  const existingKeys = new Set(
    existing.map((e) => `${normalizeName(e.name)}:${e.quantity ?? ''}:${e.unit ?? ''}`),
  );
  for (const d of deficits) {
    const key = `${normalizeName(d.name)}:${d.quantity ?? ''}:${d.unit ?? ''}`;
    if (!existingKeys.has(key)) return false;
  }
  return true;
}

async function replaceDraftItems(
  supabase: SupabaseClient<Database>,
  listId: string,
  householdId: string,
  deficits: Array<{
    name: string;
    quantity: number | null;
    unit: string | null;
    sourceMealIds: string[];
  }>,
): Promise<void> {
  const { error: delErr } = await supabase
    .schema('app')
    .from('grocery_list_item')
    .delete()
    .eq('list_id', listId);
  if (delErr) throw new Error(`pantry-diff item delete: ${delErr.message}`);
  if (deficits.length === 0) return;
  const rows = deficits.map((d) => ({
    list_id: listId,
    household_id: householdId,
    name: d.name,
    quantity: d.quantity,
    unit: d.unit,
    source_meal_id: d.sourceMealIds[0] ?? null,
    checked: false,
  }));
  const { error: insErr } = await supabase.schema('app').from('grocery_list_item').insert(rows);
  if (insErr) throw new Error(`pantry-diff item insert: ${insErr.message}`);

  const { error: updErr } = await supabase
    .schema('app')
    .from('grocery_list')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', listId);
  if (updErr) throw new Error(`pantry-diff list touch: ${updErr.message}`);
}

async function createDraft(
  supabase: SupabaseClient<Database>,
  householdId: string,
  plannedFor: string,
  deficits: Array<{
    name: string;
    quantity: number | null;
    unit: string | null;
    sourceMealIds: string[];
  }>,
): Promise<string> {
  const { data: inserted, error: listErr } = await supabase
    .schema('app')
    .from('grocery_list')
    .insert({
      household_id: householdId,
      planned_for: plannedFor,
      status: 'draft',
      provider: 'pantry_diff',
    })
    .select('id')
    .single();
  if (listErr || !inserted) {
    throw new Error(`pantry-diff draft insert: ${listErr?.message ?? 'no id'}`);
  }
  const listId = inserted.id as string;

  const itemRows = deficits.map((d) => ({
    list_id: listId,
    household_id: householdId,
    name: d.name,
    quantity: d.quantity,
    unit: d.unit,
    source_meal_id: d.sourceMealIds[0] ?? null,
    checked: false,
  }));
  if (itemRows.length > 0) {
    const { error: itemErr } = await supabase
      .schema('app')
      .from('grocery_list_item')
      .insert(itemRows);
    if (itemErr) throw new Error(`pantry-diff item insert: ${itemErr.message}`);
  }
  return listId;
}

async function writeAudit(
  supabase: SupabaseClient<Database>,
  input: { household_id: string; action: string; resource_id: string; after: unknown },
): Promise<void> {
  const { error } = await supabase
    .schema('audit')
    .from('event')
    .insert({
      household_id: input.household_id,
      actor_user_id: null,
      action: input.action,
      resource_type: 'app.grocery_list',
      resource_id: input.resource_id,
      before: null,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[pantry-diff] audit write failed: ${error.message}`);
  }
}

/** Re-exported for tests. */
export const __internal = {
  nextSaturday,
  normalizeName,
  sameDeficitSet,
};
