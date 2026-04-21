/**
 * `social-materializer` handler.
 *
 * Spec anchors:
 *   - `specs/06-segments/social/calendar.md` — "Generation of recurring
 *     social events" (birthdays + anniversaries on a rolling 12-month
 *     horizon).
 *
 * Algorithm, per household:
 *   1. Load `mem.fact` rows with predicate in `{has_birthday,
 *      has_anniversary}` that are currently valid (`valid_to IS NULL`
 *      AND `superseded_at IS NULL`).
 *   2. Extract month/day from the fact's `object_value` (accepts
 *      `YYYY-MM-DD`, `MM-DD`, or `{ month, day }` JSON shapes).
 *   3. Compute the next occurrence on or after `now` (same calendar
 *      year if still ahead, else next year).
 *   4. Upsert an `app.event` row scoped by
 *      `(household_id, kind, starts_at, metadata->>subject_node_id)`.
 *      The partial unique index requested in migration 0014 makes this
 *      a no-op on re-run. When the index is not yet installed we fall
 *      back to a select-then-insert check.
 *   5. Soft-delete stale events (`metadata.stale=true`): any event
 *      written for this person but whose source fact has either been
 *      superseded or has changed to a different month/day.
 *
 * Idempotence: repeated runs don't insert duplicates; when a birthday
 * fact changes, the old materialized event is marked stale and the
 * new occurrence is inserted.
 *
 * Cost: no model calls. A household with zero birthday/anniversary
 * facts costs one `fact` query and exits.
 */

import { type Database, type Json } from '@homehub/db';
import { type Logger } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

type FactRow = Database['mem']['Tables']['fact']['Row'];
type NodeRow = Database['mem']['Tables']['node']['Row'];
type EventRow = Database['app']['Tables']['event']['Row'];

/** The fact predicates we materialize. */
export const MATERIALIZED_PREDICATES = ['has_birthday', 'has_anniversary'] as const;
export type MaterializedPredicate = (typeof MATERIALIZED_PREDICATES)[number];

export const PREDICATE_TO_EVENT_KIND: Record<MaterializedPredicate, 'birthday' | 'anniversary'> = {
  has_birthday: 'birthday',
  has_anniversary: 'anniversary',
};

export interface SocialMaterializerDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  now?: () => Date;
  /** Restrict to a subset of households. Defaults to all. */
  householdIds?: string[];
}

export interface MaterializerHouseholdResult {
  householdId: string;
  factsConsidered: number;
  eventsInserted: number;
  eventsReused: number;
  staleMarked: number;
  errors: number;
}

export async function runSocialMaterializer(
  deps: SocialMaterializerDeps,
): Promise<MaterializerHouseholdResult[]> {
  const now = (deps.now ?? (() => new Date()))();
  const householdIds = deps.householdIds ?? (await listHouseholds(deps.supabase));
  const out: MaterializerHouseholdResult[] = [];

  for (const householdId of householdIds) {
    try {
      const result = await runForHousehold(deps, householdId, now);
      out.push(result);
    } catch (err) {
      deps.log.error('social-materializer: household failed', {
        household_id: householdId,
        error: err instanceof Error ? err.message : String(err),
      });
      out.push({
        householdId,
        factsConsidered: 0,
        eventsInserted: 0,
        eventsReused: 0,
        staleMarked: 0,
        errors: 1,
      });
    }
  }

  deps.log.info('social-materializer run complete', {
    households: householdIds.length,
    inserted: out.reduce((acc, r) => acc + r.eventsInserted, 0),
    reused: out.reduce((acc, r) => acc + r.eventsReused, 0),
    stale_marked: out.reduce((acc, r) => acc + r.staleMarked, 0),
  });
  return out;
}

async function runForHousehold(
  deps: SocialMaterializerDeps,
  householdId: string,
  now: Date,
): Promise<MaterializerHouseholdResult> {
  const facts = await loadActiveBirthdayFacts(deps.supabase, householdId);
  const events = await loadMaterializedEvents(deps.supabase, householdId);

  // Existing event key helper — matches the partial unique index.
  const eventKey = (kind: string, startsAt: string, subjectNodeId: string) =>
    `${kind}::${startsAt}::${subjectNodeId}`;

  const existingByKey = new Map<string, EventRow>();
  const existingBySubjectKind = new Map<string, EventRow[]>();
  for (const e of events) {
    const meta = coerceMeta(e.metadata);
    const subjectNodeId =
      typeof meta['subject_node_id'] === 'string' ? meta['subject_node_id'] : null;
    if (!subjectNodeId) continue;
    const k = eventKey(e.kind, e.starts_at, subjectNodeId);
    existingByKey.set(k, e);
    const listKey = `${subjectNodeId}::${e.kind}`;
    const list = existingBySubjectKind.get(listKey) ?? [];
    list.push(e);
    existingBySubjectKind.set(listKey, list);
  }

  let inserted = 0;
  let reused = 0;
  let staleMarked = 0;
  const seenKeys = new Set<string>();

  for (const fact of facts) {
    const predicate = fact.predicate as MaterializedPredicate;
    const kind = PREDICATE_TO_EVENT_KIND[predicate];
    if (!kind) continue;

    const parsed = parseMonthDay(fact.object_value);
    if (!parsed) {
      deps.log.warn('social-materializer: unparseable month/day', {
        fact_id: fact.id,
        predicate: fact.predicate,
      });
      continue;
    }

    const startsAt = nextOccurrenceUtc(parsed.month, parsed.day, now);
    const subjectNodeId = fact.subject_node_id;
    const key = eventKey(kind, startsAt, subjectNodeId);
    seenKeys.add(key);

    const existing = existingByKey.get(key);
    const title = await buildTitle(deps.supabase, householdId, subjectNodeId, kind);

    if (existing) {
      // Event already exists for this year. If metadata.stale was
      // previously set (say a prior run marked it stale before the
      // current fact was re-added), restore it.
      const meta = coerceMeta(existing.metadata);
      if (meta['stale'] === true) {
        const merged = { ...meta, stale: false, source_fact_id: fact.id };
        const { error: updErr } = await deps.supabase
          .schema('app')
          .from('event')
          .update({ metadata: merged as unknown as Json })
          .eq('id', existing.id);
        if (updErr) {
          deps.log.warn('social-materializer: unstale update failed', {
            event_id: existing.id,
            error: updErr.message,
          });
        }
      }
      reused += 1;
      continue;
    }

    const insert: Database['app']['Tables']['event']['Insert'] = {
      household_id: householdId,
      segment: 'social',
      kind,
      title,
      starts_at: startsAt,
      ends_at: null,
      all_day: true,
      owner_member_id: null,
      metadata: {
        subject_node_id: subjectNodeId,
        predicate: fact.predicate,
        source_fact_id: fact.id,
        materialized_by: 'social-materializer',
      } as unknown as Json,
    };
    const { error: insErr } = await deps.supabase.schema('app').from('event').insert(insert);
    if (insErr) {
      // Unique-constraint collision is expected when the partial
      // unique index is active and two runs race. Treat as reuse.
      if (/duplicate|unique/i.test(insErr.message)) {
        reused += 1;
        continue;
      }
      throw new Error(`event insert failed: ${insErr.message}`);
    }
    inserted += 1;
  }

  // Stale sweep: any event this household owns for a (subject, kind)
  // pair we did NOT touch in the seen set becomes stale unless the
  // event is in the past (historical events stay as-is).
  const nowMs = now.getTime();
  for (const e of events) {
    const meta = coerceMeta(e.metadata);
    const subjectNodeId =
      typeof meta['subject_node_id'] === 'string' ? meta['subject_node_id'] : null;
    if (!subjectNodeId) continue;
    if (e.kind !== 'birthday' && e.kind !== 'anniversary') continue;
    const k = eventKey(e.kind, e.starts_at, subjectNodeId);
    if (seenKeys.has(k)) continue;
    const startMs = new Date(e.starts_at).getTime();
    if (Number.isFinite(startMs) && startMs < nowMs) continue; // leave past events alone
    if (meta['stale'] === true) continue;
    const merged = { ...meta, stale: true };
    const { error: updErr } = await deps.supabase
      .schema('app')
      .from('event')
      .update({ metadata: merged as unknown as Json })
      .eq('id', e.id);
    if (updErr) {
      deps.log.warn('social-materializer: stale mark failed', {
        event_id: e.id,
        error: updErr.message,
      });
      continue;
    }
    staleMarked += 1;
  }

  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'social.materialized',
    resource_id: householdId,
    after: {
      facts_considered: facts.length,
      events_inserted: inserted,
      events_reused: reused,
      stale_marked: staleMarked,
    },
  });

  return {
    householdId,
    factsConsidered: facts.length,
    eventsInserted: inserted,
    eventsReused: reused,
    staleMarked,
    errors: 0,
  };
}

// ----- Pure helpers (exported for tests) -------------------------------

/** Extract `{month, day}` from a `mem.fact.object_value` cell. */
export function parseMonthDay(objectValue: Json | null): { month: number; day: number } | null {
  if (objectValue === null || objectValue === undefined) return null;
  if (typeof objectValue === 'string') {
    // Accept 'YYYY-MM-DD' or 'MM-DD' or ISO datetime.
    const iso = /^(\d{4})-(\d{2})-(\d{2})/;
    const md = /^(\d{1,2})-(\d{1,2})$/;
    let m: RegExpMatchArray | null = iso.exec(objectValue);
    if (m) {
      const month = Number(m[2]);
      const day = Number(m[3]);
      if (validMonthDay(month, day)) return { month, day };
    }
    m = md.exec(objectValue);
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (validMonthDay(month, day)) return { month, day };
    }
    return null;
  }
  if (typeof objectValue === 'object' && !Array.isArray(objectValue)) {
    const o = objectValue as Record<string, unknown>;
    const month = Number(o['month']);
    const day = Number(o['day']);
    if (validMonthDay(month, day)) return { month, day };
    if (typeof o['value'] === 'string') return parseMonthDay(o['value']);
  }
  return null;
}

function validMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}

/**
 * Compute the next occurrence (UTC) of a given (month, day) on or
 * after `now`. Returned as an ISO 8601 timestamp at 00:00:00Z.
 *
 * Handles leap-day birthdays (Feb 29) by falling back to Feb 28 in
 * non-leap years.
 */
export function nextOccurrenceUtc(month: number, day: number, now: Date): string {
  const year = now.getUTCFullYear();
  const candidate = makeDateUtc(year, month, day);
  if (candidate.getTime() >= startOfUtcDay(now).getTime()) {
    return candidate.toISOString();
  }
  return makeDateUtc(year + 1, month, day).toISOString();
}

function makeDateUtc(year: number, month: number, day: number): Date {
  // Clamp leap-day to Feb 28 when year is not leap.
  if (month === 2 && day === 29 && !isLeap(year)) {
    return new Date(Date.UTC(year, 1, 28));
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function coerceMeta(raw: Json | null): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

// ----- Supabase loaders ------------------------------------------------

async function listHouseholds(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase.schema('app').from('household').select('id').limit(10_000);
  if (error) throw new Error(`household scan failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

async function loadActiveBirthdayFacts(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<FactRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('fact')
    .select('*')
    .eq('household_id', householdId)
    .in('predicate', [...MATERIALIZED_PREDICATES])
    .is('valid_to', null)
    .is('superseded_at', null);
  if (error) throw new Error(`fact load failed: ${error.message}`);
  return (data ?? []) as FactRow[];
}

async function loadMaterializedEvents(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<EventRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .select('*')
    .eq('household_id', householdId)
    .eq('segment', 'social')
    .in('kind', ['birthday', 'anniversary']);
  if (error) throw new Error(`event load failed: ${error.message}`);
  return (data ?? []) as EventRow[];
}

async function buildTitle(
  supabase: SupabaseClient<Database>,
  householdId: string,
  subjectNodeId: string,
  kind: 'birthday' | 'anniversary',
): Promise<string> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('canonical_name')
    .eq('id', subjectNodeId)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error || !data) {
    return kind === 'birthday' ? 'Birthday' : 'Anniversary';
  }
  const name = (data as Pick<NodeRow, 'canonical_name'>).canonical_name;
  return kind === 'birthday' ? `${name}'s birthday` : `${name}'s anniversary`;
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
      resource_type: 'app.event',
      resource_id: input.resource_id,
      before: null,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-social-materializer] audit write failed: ${error.message}`);
  }
}
