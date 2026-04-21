/**
 * `suggestions` handler — cron-driven suggestion generator.
 *
 * M6 ships the food-segment generators (meal_swap, grocery_order,
 * new_dish). Fun + social generators are added alongside by sibling
 * dispatches — this handler wires whatever generator set is available
 * through `@homehub/suggestions`.
 *
 * Pipeline per household:
 *   1. Load the fixture data each generator needs.
 *   2. Run the deterministic generators.
 *   3. Dedupe against pending suggestions with the same `kind` +
 *      `preview.dedupe_key`.
 *   4. Insert new rows with `status='pending'`.
 *   5. Audit `suggestions.generated`.
 *
 * No approval / execution side effects — M9 owns that.
 */

import {
  detectAbsenceLong,
  detectReciprocityImbalance,
  type HomePlaceSet,
  type SocialEpisode,
  type SocialPersonNode,
} from '@homehub/alerts';
import { type Database, type Json } from '@homehub/db';
import {
  generateGiftIdea,
  generateGroceryOrderSuggestions,
  generateHostBack,
  generateMealSwapSuggestions,
  generateNewDishSuggestions,
  generateReachOut,
  type AbsentPersonInfo,
  type DishIngredientEdge,
  type DishNode,
  type FreeWindow,
  type PantryDeficit,
  type ReciprocitySignal,
  type SocialFactRow,
  type SuggestSocialEventRow,
  type SuggestSocialPersonRow,
  type SuggestionEmission,
} from '@homehub/suggestions';
import { type Logger } from '@homehub/worker-runtime';
import { NotYetImplementedError } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

export interface SuggestionsWorkerDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  now?: () => Date;
  /** Scope to a household subset; omit for all. */
  householdIds?: string[];
}

export interface SuggestionsRunSummary {
  householdId: string;
  emissions: number;
  inserted: number;
  dedupedSuppressed: number;
}

export async function runSuggestionsWorker(
  deps: SuggestionsWorkerDeps,
): Promise<SuggestionsRunSummary[]> {
  const now = (deps.now ?? (() => new Date()))();
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const out: SuggestionsRunSummary[] = [];
  for (const householdId of householdIds) {
    try {
      const summary = await runOne(deps, householdId, now);
      out.push(summary);
    } catch (err) {
      deps.log.error('suggestions: household run failed', {
        household_id: householdId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  deps.log.info('suggestions run complete', {
    households: householdIds.length,
    emitted: out.reduce((acc, s) => acc + s.emissions, 0),
    inserted: out.reduce((acc, s) => acc + s.inserted, 0),
    suppressed: out.reduce((acc, s) => acc + s.dedupedSuppressed, 0),
  });
  return out;
}

async function runOne(
  deps: SuggestionsWorkerDeps,
  householdId: string,
  now: Date,
): Promise<SuggestionsRunSummary> {
  const socialEpisodeStart = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const socialEventEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [
    mealRows,
    pantryRows,
    dishNodes,
    ingredientEdges,
    existingPending,
    latestGroceryDraft,
    socialPeople,
    socialEpisodes,
    socialEvents,
    socialPreferenceFacts,
    socialHomePlaces,
  ] = await Promise.all([
    loadMeals(deps.supabase, householdId, now),
    loadPantry(deps.supabase, householdId),
    loadDishNodes(deps.supabase, householdId),
    loadIngredientEdges(deps.supabase, householdId),
    loadPendingSuggestions(deps.supabase, householdId),
    loadLatestDraftList(deps.supabase, householdId),
    loadSocialPeople(deps.supabase, householdId),
    loadSocialEpisodes(deps.supabase, householdId, socialEpisodeStart),
    loadSocialEvents(deps.supabase, householdId, now, socialEventEnd),
    loadSocialPreferenceFacts(deps.supabase, householdId),
    loadSocialHomePlaces(deps.supabase, householdId),
  ]);

  const emissions: SuggestionEmission[] = [];

  emissions.push(
    ...(await generateMealSwapSuggestions({
      householdId,
      meals: mealRows,
      pantryItems: pantryRows,
      dishes: dishNodes,
      dishIngredientEdges: ingredientEdges,
      now,
    })),
  );

  emissions.push(
    ...(await generateNewDishSuggestions({
      householdId,
      meals: await loadRecentMeals(deps.supabase, householdId, now),
      dishes: dishNodes,
      now,
    })),
  );

  // grocery_order: rely on the latest pantry-diff-generated draft as
  // the deficit source. If a draft exists with items, emit a
  // propose_grocery_order suggestion.
  if (latestGroceryDraft && latestGroceryDraft.items.length > 0) {
    emissions.push(
      ...(await generateGroceryOrderSuggestions({
        householdId,
        plannedFor: latestGroceryDraft.plannedFor,
        deficits: latestGroceryDraft.items,
      })),
    );
  }

  // ---- Social generators (M8) ------------------------------------------
  const absenceEmissions = detectAbsenceLong({
    householdId,
    people: socialPeople,
    episodes: socialEpisodes,
    now,
  });
  const absent: AbsentPersonInfo[] = absenceEmissions.map((e) => ({
    personNodeId: (e.context.person_node_id as string) ?? '',
    canonicalName: (e.context.person_name as string) ?? 'Unknown',
    lastSeenAt: (e.context.last_seen_at as string | null) ?? null,
    daysSince: Number(e.context.days_since ?? 0),
  }));
  const reciprocityEmissions = detectReciprocityImbalance({
    householdId,
    people: socialPeople,
    episodes: socialEpisodes,
    homePlaces: socialHomePlaces,
    now,
  });
  const imbalanced: ReciprocitySignal[] = reciprocityEmissions.map((e) => ({
    personNodeId: (e.context.person_node_id as string) ?? '',
    canonicalName: (e.context.person_name as string) ?? 'Unknown',
    weHosted: Number(e.context.we_hosted ?? 0),
    hostedUs: Number(e.context.hosted_us ?? 0),
  }));
  const freeWindows = proposeWeekendWindows(now, 3);
  const suggestPeople: SuggestSocialPersonRow[] = socialPeople.map((p) => ({
    id: p.id,
    household_id: p.household_id,
    canonical_name: p.canonical_name,
    metadata: p.metadata,
    created_at: p.created_at,
  }));
  const suggestEvents: SuggestSocialEventRow[] = socialEvents.map((e) => ({
    id: e.id,
    household_id: e.household_id,
    kind: e.kind,
    title: e.title,
    starts_at: e.starts_at,
    all_day: e.all_day,
    metadata: e.metadata,
  }));

  emissions.push(...(await generateReachOut({ householdId, absent, now })));
  emissions.push(
    ...(await generateGiftIdea({
      householdId,
      events: suggestEvents,
      facts: socialPreferenceFacts,
      people: suggestPeople,
      now,
    })),
  );
  emissions.push(...(await generateHostBack({ householdId, imbalanced, freeWindows, now })));

  // ---- Dedupe against existing pending suggestions ---------------------
  const dedupeKeys = new Set<string>();
  for (const s of existingPending) {
    const preview = (s.preview as Record<string, unknown> | null) ?? {};
    const key = typeof preview.dedupe_key === 'string' ? preview.dedupe_key : null;
    if (key) dedupeKeys.add(`${s.kind}::${key}`);
  }

  let inserted = 0;
  let suppressed = 0;
  for (const emission of emissions) {
    const key = `${emission.kind}::${emission.dedupeKey}`;
    if (dedupeKeys.has(key)) {
      suppressed += 1;
      continue;
    }
    try {
      await insertSuggestion(deps.supabase, householdId, emission);
      dedupeKeys.add(key);
      inserted += 1;
    } catch (err) {
      deps.log.warn('suggestions: insert failed', {
        kind: emission.kind,
        dedupe_key: emission.dedupeKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'suggestions.generated',
    resource_id: householdId,
    after: {
      emissions: emissions.length,
      inserted,
      suppressed,
    },
  });

  return { householdId, emissions: emissions.length, inserted, dedupedSuppressed: suppressed };
}

// ---- Loaders ---------------------------------------------------------------

async function listHouseholds(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase.schema('app').from('household').select('id').limit(10_000);
  if (error) throw new Error(`household scan: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

interface MealRow {
  id: string;
  household_id: string;
  planned_for: string;
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  dish_node_id: string | null;
  status: 'planned' | 'cooking' | 'served' | 'skipped';
}

async function loadMeals(
  supabase: SupabaseClient<Database>,
  householdId: string,
  now: Date,
): Promise<MealRow[]> {
  const fromIso = now.toISOString().slice(0, 10);
  const toDate = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .schema('app')
    .from('meal')
    .select('id, household_id, planned_for, slot, title, dish_node_id, status')
    .eq('household_id', householdId)
    .gte('planned_for', fromIso)
    .lte('planned_for', toDate.toISOString().slice(0, 10));
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    planned_for: r.planned_for as string,
    slot: r.slot as MealRow['slot'],
    title: r.title as string,
    dish_node_id: (r.dish_node_id as string | null) ?? null,
    status: r.status as MealRow['status'],
  }));
}

async function loadRecentMeals(
  supabase: SupabaseClient<Database>,
  householdId: string,
  now: Date,
): Promise<MealRow[]> {
  const fromDate = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .schema('app')
    .from('meal')
    .select('id, household_id, planned_for, slot, title, dish_node_id, status')
    .eq('household_id', householdId)
    .gte('planned_for', fromDate.toISOString().slice(0, 10))
    .lte('planned_for', now.toISOString().slice(0, 10));
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    planned_for: r.planned_for as string,
    slot: r.slot as MealRow['slot'],
    title: r.title as string,
    dish_node_id: (r.dish_node_id as string | null) ?? null,
    status: r.status as MealRow['status'],
  }));
}

interface PantryRow {
  id: string;
  household_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  expires_on: string | null;
  location: string | null;
}

async function loadPantry(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<PantryRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('pantry_item')
    .select('id, household_id, name, quantity, unit, expires_on, location')
    .eq('household_id', householdId)
    .limit(500);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    name: r.name as string,
    quantity: (r.quantity as number | null) ?? null,
    unit: (r.unit as string | null) ?? null,
    expires_on: (r.expires_on as string | null) ?? null,
    location: (r.location as string | null) ?? null,
  }));
}

async function loadDishNodes(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<DishNode[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('id, household_id, canonical_name, metadata, created_at')
    .eq('household_id', householdId)
    .eq('type', 'dish')
    .limit(300);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    canonical_name: r.canonical_name as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.created_at as string,
  }));
}

async function loadIngredientEdges(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<DishIngredientEdge[]> {
  // Load edges of type 'contains' with src = dish, dst = ingredient.
  const { data: edges, error: edgeErr } = await supabase
    .schema('mem')
    .from('edge')
    .select('household_id, src_id, dst_id, type')
    .eq('household_id', householdId)
    .eq('type', 'contains')
    .limit(2_000);
  if (edgeErr) return [];
  const ingredientIds = [...new Set((edges ?? []).map((e) => e.dst_id as string))];
  if (ingredientIds.length === 0) return [];
  const { data: ingredientNodes, error: nodeErr } = await supabase
    .schema('mem')
    .from('node')
    .select('id, canonical_name, type')
    .eq('household_id', householdId)
    .in('id', ingredientIds);
  if (nodeErr) return [];
  const nameById = new Map<string, string>();
  for (const n of ingredientNodes ?? []) {
    if (n.type !== 'ingredient') continue;
    nameById.set(n.id as string, n.canonical_name as string);
  }
  return (edges ?? [])
    .map((e) => {
      const ingredientName = nameById.get(e.dst_id as string);
      if (!ingredientName) return null;
      return {
        household_id: e.household_id as string,
        dish_node_id: e.src_id as string,
        ingredient_node_id: e.dst_id as string,
        ingredient_name: ingredientName,
      } satisfies DishIngredientEdge;
    })
    .filter((e): e is DishIngredientEdge => e !== null);
}

interface PendingSuggestionRow {
  id: string;
  kind: string;
  preview: Record<string, unknown> | null;
}

async function loadPendingSuggestions(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<PendingSuggestionRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('suggestion')
    .select('id, kind, preview')
    .eq('household_id', householdId)
    .eq('status', 'pending')
    .limit(500);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    preview: (r.preview as Record<string, unknown> | null) ?? null,
  }));
}

async function loadLatestDraftList(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<{ plannedFor: string; items: PantryDeficit[] } | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('grocery_list')
    .select('id, planned_for')
    .eq('household_id', householdId)
    .eq('status', 'draft')
    .eq('provider', 'pantry_diff')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || !data.planned_for) return null;

  const { data: items, error: itemsErr } = await supabase
    .schema('app')
    .from('grocery_list_item')
    .select('name, quantity, unit, source_meal_id')
    .eq('list_id', data.id)
    .limit(200);
  if (itemsErr) return null;

  return {
    plannedFor: data.planned_for as string,
    items: (items ?? []).map((i) => ({
      name: i.name as string,
      quantity: (i.quantity as number | null) ?? null,
      unit: (i.unit as string | null) ?? null,
      sourceMealIds: i.source_meal_id ? [i.source_meal_id as string] : [],
    })),
  };
}

// ---- Persistence -----------------------------------------------------------

async function insertSuggestion(
  supabase: SupabaseClient<Database>,
  householdId: string,
  emission: SuggestionEmission,
): Promise<void> {
  const { error } = await supabase
    .schema('app')
    .from('suggestion')
    .insert({
      household_id: householdId,
      segment: emission.segment,
      kind: emission.kind,
      title: emission.title,
      rationale: emission.rationale,
      preview: emission.preview as unknown as Json,
      status: 'pending',
    });
  if (error) throw new Error(`suggestion insert: ${error.message}`);
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
      resource_type: 'app.suggestion',
      resource_id: input.resource_id,
      before: null,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-suggestions] audit write failed: ${error.message}`);
  }
}

// ---- Social loaders + helpers (M8) --------------------------------------

async function loadSocialPeople(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<SocialPersonNode[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('id, household_id, canonical_name, metadata, needs_review, created_at')
    .eq('household_id', householdId)
    .eq('type', 'person');
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    canonical_name: r.canonical_name as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    needs_review: Boolean(r.needs_review),
    created_at: r.created_at as string,
  }));
}

async function loadSocialEpisodes(
  supabase: SupabaseClient<Database>,
  householdId: string,
  start: Date,
): Promise<SocialEpisode[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('episode')
    .select('id, household_id, occurred_at, participants, place_node_id, source_type, metadata')
    .eq('household_id', householdId)
    .gte('occurred_at', start.toISOString());
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    occurred_at: r.occurred_at as string,
    participants: (r.participants as string[] | null) ?? [],
    place_node_id: (r.place_node_id as string | null) ?? null,
    source_type: r.source_type as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

async function loadSocialEvents(
  supabase: SupabaseClient<Database>,
  householdId: string,
  start: Date,
  end: Date,
): Promise<
  Array<{
    id: string;
    household_id: string;
    kind: string;
    title: string;
    starts_at: string;
    all_day: boolean;
    metadata: Record<string, unknown>;
  }>
> {
  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .select('id, household_id, kind, title, starts_at, all_day, metadata')
    .eq('household_id', householdId)
    .eq('segment', 'social')
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString());
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    kind: r.kind as string,
    title: r.title as string,
    starts_at: r.starts_at as string,
    all_day: Boolean(r.all_day),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));
}

async function loadSocialPreferenceFacts(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<SocialFactRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('fact')
    .select(
      'id, household_id, subject_node_id, predicate, object_value, object_node_id, valid_to, superseded_at, recorded_at',
    )
    .eq('household_id', householdId)
    .in('predicate', ['prefers', 'interested_in', 'avoids'] as unknown as string[]);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    subject_node_id: r.subject_node_id as string,
    predicate: r.predicate as string,
    object_value: r.object_value,
    object_node_id: (r.object_node_id as string | null) ?? null,
    valid_to: (r.valid_to as string | null) ?? null,
    superseded_at: (r.superseded_at as string | null) ?? null,
    recorded_at: r.recorded_at as string,
  }));
}

async function loadSocialHomePlaces(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<HomePlaceSet> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('id, metadata')
    .eq('household_id', householdId)
    .eq('type', 'place');
  const set = new Set<string>();
  if (error) return set;
  for (const row of data ?? []) {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    if (meta['is_home'] === true) set.add(row.id as string);
  }
  return set;
}

/**
 * Simple weekend-window proposer. Returns Saturday evenings (18:00 →
 * 22:00 UTC) for the next N weeks. The M9 approval-flow worker is the
 * one meant to scan real free-time windows; this keeps the host_back
 * suggestion shape useful in the meantime.
 */
export function proposeWeekendWindows(now: Date, count: number): FreeWindow[] {
  const out: FreeWindow[] = [];
  const baseDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekday = baseDay.getUTCDay(); // 6 = Saturday
  const daysUntilSat = (6 - weekday + 7) % 7 || 7; // always future
  const firstSat = new Date(baseDay.getTime() + daysUntilSat * 86_400_000);
  for (let i = 0; i < count; i += 1) {
    const sat = new Date(firstSat.getTime() + i * 7 * 86_400_000);
    const startsAt = new Date(sat.getTime() + 18 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(sat.getTime() + 22 * 60 * 60 * 1000).toISOString();
    out.push({ startsAt, endsAt, label: `Sat ${sat.toISOString().slice(0, 10)} evening` });
  }
  return out;
}

// Legacy stub kept for compatibility; the old handler.test.ts exercises it.
export async function handler(): Promise<void> {
  throw new NotYetImplementedError('suggestions: use runSuggestionsWorker() instead of handler()');
}
