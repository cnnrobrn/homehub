/**
 * Fun-segment suggestions runner (M7).
 *
 * Cron-driven. Computes outing ideas, trip prep checklists, and
 * book-reservation nudges deterministically and upserts rows into
 * `app.suggestion` with `status='pending'`.
 *
 * Pipeline per household:
 *   1. Load the next 14d of fun+social events.
 *   2. Load preference places (`mem.node type=place`) with their
 *      attended edge counts.
 *   3. Load upcoming trip parent events.
 *   4. Run each generator over the in-memory inputs.
 *   5. Dedupe against existing pending/approved suggestions via
 *      `preview.dedupe_key`.
 *   6. Insert new suggestions + audit.
 *
 * No model calls. The `outing_idea` rationale can later be polished via
 * a RationaleWriter — M7 ships the deterministic rationale.
 */

import { type Database, type Json } from '@homehub/db';
import {
  generateBookReservation,
  generateOutingIdea,
  generateTripPrep,
  type BookReservationPlaceNode,
  type OutingIdeaPreferencePlace,
  type SuggestionEmission,
  type TripPrepTrip,
} from '@homehub/suggestions';
import { type Logger } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

export const FUN_SUGGESTIONS_EVENT_LOOKAHEAD_DAYS = 14;
export const FUN_SUGGESTIONS_TRIP_LOOKAHEAD_DAYS = 14;

export interface FunSuggestionsWorkerDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  now?: () => Date;
  householdIds?: string[];
}

export interface FunSuggestionsRunSummary {
  householdId: string;
  emissions: number;
  inserted: number;
  suppressed: number;
}

export async function runFunSuggestionsWorker(
  deps: FunSuggestionsWorkerDeps,
): Promise<FunSuggestionsRunSummary[]> {
  const now = (deps.now ?? (() => new Date()))();
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const summaries: FunSuggestionsRunSummary[] = [];

  for (const householdId of householdIds) {
    try {
      const summary = await runForHousehold(deps, householdId, now);
      summaries.push(summary);
    } catch (err) {
      deps.log.error('fun suggestions: household run failed', {
        household_id: householdId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  deps.log.info('fun suggestions run complete', {
    households: householdIds.length,
    emitted: summaries.reduce((acc, s) => acc + s.emissions, 0),
    inserted: summaries.reduce((acc, s) => acc + s.inserted, 0),
  });
  return summaries;
}

async function runForHousehold(
  deps: FunSuggestionsWorkerDeps,
  householdId: string,
  now: Date,
): Promise<FunSuggestionsRunSummary> {
  const eventHorizon = new Date(
    now.getTime() + FUN_SUGGESTIONS_EVENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
  );
  const tripHorizon = new Date(
    now.getTime() + FUN_SUGGESTIONS_TRIP_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
  );

  const [events, trips, places] = await Promise.all([
    loadFunAndSocialEvents(deps.supabase, householdId, now, eventHorizon),
    loadUpcomingTrips(deps.supabase, householdId, now, tripHorizon),
    loadPlaceNodes(deps.supabase, householdId),
  ]);

  const preferencePlaces: OutingIdeaPreferencePlace[] = places.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    attendedCount: p.attendedAtIso.length,
  }));

  const emissions: SuggestionEmission[] = [
    ...generateOutingIdea({
      householdId,
      now,
      events,
      preferences: preferencePlaces,
    }),
    ...generateTripPrep({
      householdId,
      now,
      trips,
    }),
    ...generateBookReservation({
      householdId,
      now,
      places,
    }),
  ];

  const activeKeys = await loadActiveDedupeKeys(deps.supabase, householdId);
  let inserted = 0;
  let suppressed = 0;
  for (const emission of emissions) {
    const key = `${emission.kind}::${emission.dedupeKey}`;
    if (activeKeys.has(key)) {
      suppressed += 1;
      continue;
    }
    try {
      await insertSuggestion(deps.supabase, emission, householdId);
      activeKeys.add(key);
      inserted += 1;
    } catch (err) {
      deps.log.warn('fun suggestions: insert failed', {
        kind: emission.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'suggestions.fun.generated',
    resource_id: householdId,
    after: { emissions: emissions.length, inserted, suppressed },
  });

  return { householdId, emissions: emissions.length, inserted, suppressed };
}

async function listHouseholds(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase.schema('app').from('household').select('id').limit(10_000);
  if (error) throw new Error(`household scan failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

async function loadFunAndSocialEvents(
  supabase: SupabaseClient<Database>,
  householdId: string,
  start: Date,
  end: Date,
): Promise<Array<{ starts_at: string; ends_at: string | null; segment: string }>> {
  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .select('starts_at, ends_at, segment')
    .eq('household_id', householdId)
    .in('segment', ['fun', 'social'])
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString());
  if (error) return [];
  return (data ?? []).map((r) => ({
    starts_at: r.starts_at as string,
    ends_at: (r.ends_at as string | null) ?? null,
    segment: r.segment as string,
  }));
}

async function loadUpcomingTrips(
  supabase: SupabaseClient<Database>,
  householdId: string,
  start: Date,
  end: Date,
): Promise<TripPrepTrip[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .select('id, household_id, segment, kind, title, starts_at, ends_at, location')
    .eq('household_id', householdId)
    .eq('segment', 'fun')
    .eq('kind', 'trip')
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString());
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    household_id: r.household_id as string,
    segment: r.segment as string,
    kind: r.kind as string,
    title: r.title as string,
    starts_at: r.starts_at as string,
    ends_at: (r.ends_at as string | null) ?? null,
    location: (r.location as string | null) ?? null,
  }));
}

async function loadPlaceNodes(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<BookReservationPlaceNode[]> {
  const { data: nodes, error } = await supabase
    .schema('mem')
    .from('node')
    .select('id, household_id, canonical_name, metadata')
    .eq('household_id', householdId)
    .eq('type', 'place');
  if (error) return [];

  // Load attended edges in one query so per-place attended lists are
  // cheap. `mem.edge.evidence` is the source of truth for timestamps;
  // we index into each `evidence` entry's `occurred_at` when present
  // and fall back to `created_at`.
  const placeIds = (nodes ?? []).map((n) => n.id as string);
  if (placeIds.length === 0) return [];
  const { data: edges } = await supabase
    .schema('mem')
    .from('edge')
    .select('dst_id, evidence, created_at, type')
    .eq('household_id', householdId)
    .eq('type', 'attended')
    .in('dst_id', placeIds);

  const byDst = new Map<string, string[]>();
  for (const edge of edges ?? []) {
    const dst = edge.dst_id as string;
    const evidence = edge.evidence as unknown;
    const ts = extractIso(evidence) ?? (edge.created_at as string);
    const arr = byDst.get(dst);
    if (arr) arr.push(ts);
    else byDst.set(dst, [ts]);
  }

  return (nodes ?? []).map((n) => {
    const id = n.id as string;
    const meta = (n.metadata as Record<string, unknown>) ?? {};
    return {
      id,
      household_id: n.household_id as string,
      name: n.canonical_name as string,
      category: typeof meta.category === 'string' ? (meta.category as string) : null,
      attendedAtIso: byDst.get(id) ?? [],
    };
  });
}

function extractIso(evidence: unknown): string | null {
  if (!Array.isArray(evidence)) return null;
  for (const e of evidence) {
    if (e && typeof e === 'object' && 'occurred_at' in e) {
      const v = (e as { occurred_at?: unknown }).occurred_at;
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

async function loadActiveDedupeKeys(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .schema('app')
    .from('suggestion')
    .select('kind, preview, status')
    .eq('household_id', householdId)
    .eq('segment', 'fun')
    .in('status', ['pending', 'approved']);
  const keys = new Set<string>();
  if (error) return keys;
  for (const row of data ?? []) {
    const preview = row.preview as Record<string, unknown> | null;
    if (!preview || typeof preview !== 'object') continue;
    const dedupeKey = preview.dedupe_key;
    const kind = row.kind as string;
    if (typeof dedupeKey === 'string') {
      keys.add(`${kind}::${dedupeKey}`);
    }
  }
  return keys;
}

async function insertSuggestion(
  supabase: SupabaseClient<Database>,
  emission: SuggestionEmission,
  householdId: string,
): Promise<void> {
  const insert: Database['app']['Tables']['suggestion']['Insert'] = {
    household_id: householdId,
    segment: emission.segment,
    kind: emission.kind,
    status: 'pending',
    title: emission.title,
    rationale: emission.rationale,
    preview: emission.preview as unknown as Json,
  };
  const { error } = await supabase.schema('app').from('suggestion').insert(insert);
  if (error) throw new Error(`suggestion insert failed: ${error.message}`);
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
