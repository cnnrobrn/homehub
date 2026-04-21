/**
 * Structural pattern detectors for the nightly consolidator.
 *
 * These detectors run over `mem.episode` rows for a household. No
 * model calls — pure SQL-shape aggregations in JS after the fetch.
 * Emits `mem.pattern` rows keyed on `(household_id, kind,
 * description_hash)` so re-running the nightly pass upserts in place
 * rather than duplicating.
 *
 * Spec anchor:
 *   - `specs/04-memory-network/consolidation.md` § Procedural
 *     patterns — three kinds (temporal, co-occurrence, threshold),
 *     each with sample_size / observed_from / observed_to /
 *     last_reinforced_at.
 *   - `specs/04-memory-network/memory-layers.md` § Procedural — these
 *     rows feed the procedural layer.
 *
 * Cost note: no model calls, so `withBudgetGuard` is unnecessary for
 * the structural pass. The consolidator still gates the per-entity
 * model-backed pass.
 */

import { createHash } from 'node:crypto';

import { type Database, type Json } from '@homehub/db';
import { type HouseholdId } from '@homehub/shared';
import { type Logger } from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

type EpisodeRow = Database['mem']['Tables']['episode']['Row'];
type PatternInsert = Database['mem']['Tables']['pattern']['Insert'];
type PatternRow = Database['mem']['Tables']['pattern']['Row'];

/**
 * Temporal pattern threshold: require at least this many matching
 * episodes before emitting. Below this, the signal is too thin to
 * trust. Spec gives wide latitude; we start conservative.
 */
export const TEMPORAL_MIN_TOTAL = 4;
export const TEMPORAL_MIN_SUPPORT_RATIO = 0.6;

/**
 * Co-occurrence thresholds: participant-pair appears in ≥40% of
 * either participant's episodes AND appears ≥3 times.
 */
export const COOCCURRENCE_MIN_COUNT = 3;
export const COOCCURRENCE_MIN_RATIO = 0.4;

export interface PatternDetectorDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  now?: () => Date;
}

export interface DetectPatternsResult {
  /** Number of pattern rows inserted or updated. */
  upserts: number;
}

/**
 * Deterministic hash used as the stable upsert key alongside
 * `(household_id, kind)`. The pattern's `description` is the semantic
 * key — two runs that derive the same pattern must land on the same
 * hash. We truncate the hex digest to 16 chars which is plenty
 * collision-resistant for a per-household scope.
 */
export function descriptionHash(description: string): string {
  return createHash('sha256').update(description).digest('hex').slice(0, 16);
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Load every episode for a household within a window. Used by each
 * detector; the caller pulls once and passes the same rows to all.
 */
export async function loadEpisodesForHousehold(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  opts: { lookbackDays?: number; now: Date } = { now: new Date() },
): Promise<EpisodeRow[]> {
  const lookbackDays = opts.lookbackDays ?? 90;
  const from = new Date(opts.now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .schema('mem')
    .from('episode')
    .select('*')
    .eq('household_id', householdId)
    .gte('occurred_at', from)
    .order('occurred_at', { ascending: true });
  if (error) throw new Error(`mem.episode load failed: ${error.message}`);
  return (data ?? []) as EpisodeRow[];
}

// -------------------------------------------------------------------
// Temporal: "most {source_type} episodes happen on {weekday}".
// Bucket by (source_type, participant-canonical-set). For each bucket
// count the weekday distribution; emit when dominant weekday clears
// the support ratio + minimum total.
// -------------------------------------------------------------------

interface TemporalBucket {
  sourceType: string;
  participantKey: string;
  participants: string[];
  byDay: Record<string, number>;
  total: number;
  firstAt: string;
  lastAt: string;
}

export function detectTemporalPatterns(episodes: EpisodeRow[]): PatternCandidate[] {
  if (episodes.length < TEMPORAL_MIN_TOTAL) return [];
  const buckets = new Map<string, TemporalBucket>();
  for (const ep of episodes) {
    const participants = [...ep.participants].sort();
    const participantKey = participants.join('|');
    const sourceType = ep.source_type;
    const key = `${sourceType}::${participantKey}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        sourceType,
        participantKey,
        participants,
        byDay: {},
        total: 0,
        firstAt: ep.occurred_at,
        lastAt: ep.occurred_at,
      };
      buckets.set(key, bucket);
    }
    const when = new Date(ep.occurred_at);
    if (!Number.isFinite(when.getTime())) continue;
    const day = WEEKDAYS[when.getUTCDay()]!;
    bucket.byDay[day] = (bucket.byDay[day] ?? 0) + 1;
    bucket.total += 1;
    if (ep.occurred_at < bucket.firstAt) bucket.firstAt = ep.occurred_at;
    if (ep.occurred_at > bucket.lastAt) bucket.lastAt = ep.occurred_at;
  }

  const out: PatternCandidate[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.total < TEMPORAL_MIN_TOTAL) continue;
    const entries = Object.entries(bucket.byDay).sort((a, b) => b[1] - a[1]);
    const [topDay, topCount] = entries[0]!;
    const ratio = topCount / bucket.total;
    if (ratio < TEMPORAL_MIN_SUPPORT_RATIO) continue;
    const participantLabel =
      bucket.participants.length > 0
        ? `${bucket.sourceType} episodes with participants [${bucket.participantKey}]`
        : `${bucket.sourceType} episodes`;
    const description = `Most ${participantLabel} happen on ${topDay}`;
    out.push({
      kind: 'temporal',
      description,
      parameters: {
        source_type: bucket.sourceType,
        participants: bucket.participants,
        dominant_day: topDay,
        distribution: bucket.byDay,
        support_ratio: ratio,
        period_days: 7,
      },
      confidence: ratio,
      sample_size: bucket.total,
      observed_from: bucket.firstAt,
      observed_to: bucket.lastAt,
      last_reinforced_at: bucket.lastAt,
    });
  }
  return out;
}

// -------------------------------------------------------------------
// Co-occurrence: a pair (A, B) appears in ≥40% of A's OR B's
// episodes AND appears ≥3 times.
// -------------------------------------------------------------------

export function detectCoOccurrencePatterns(episodes: EpisodeRow[]): PatternCandidate[] {
  if (episodes.length === 0) return [];
  const episodesByParticipant = new Map<string, EpisodeRow[]>();
  const pairEpisodes = new Map<string, { a: string; b: string; episodes: EpisodeRow[] }>();

  for (const ep of episodes) {
    for (const p of ep.participants) {
      if (!episodesByParticipant.has(p)) episodesByParticipant.set(p, []);
      episodesByParticipant.get(p)!.push(ep);
    }
    const unique = Array.from(new Set(ep.participants));
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const left = unique[i]!;
        const right = unique[j]!;
        const [a, b] = left <= right ? [left, right] : [right, left];
        const key = `${a}::${b}`;
        let bucket = pairEpisodes.get(key);
        if (!bucket) {
          bucket = { a, b, episodes: [] };
          pairEpisodes.set(key, bucket);
        }
        bucket.episodes.push(ep);
      }
    }
  }

  const out: PatternCandidate[] = [];
  for (const { a, b, episodes: pairEps } of pairEpisodes.values()) {
    if (pairEps.length < COOCCURRENCE_MIN_COUNT) continue;
    const aTotal = episodesByParticipant.get(a)?.length ?? 0;
    const bTotal = episodesByParticipant.get(b)?.length ?? 0;
    const ratioA = aTotal > 0 ? pairEps.length / aTotal : 0;
    const ratioB = bTotal > 0 ? pairEps.length / bTotal : 0;
    const bestRatio = Math.max(ratioA, ratioB);
    if (bestRatio < COOCCURRENCE_MIN_RATIO) continue;
    pairEps.sort((e1, e2) => e1.occurred_at.localeCompare(e2.occurred_at));
    const firstAt = pairEps[0]!.occurred_at;
    const lastAt = pairEps[pairEps.length - 1]!.occurred_at;
    // Estimate period from the span of observations.
    const periodDays = estimatePeriodDays(pairEps);
    const description = `Participants ${a} and ${b} co-occur in episodes`;
    out.push({
      kind: 'co_occurrence',
      description,
      parameters: {
        participants: [a, b],
        count: pairEps.length,
        a_total: aTotal,
        b_total: bTotal,
        ratio_a: ratioA,
        ratio_b: ratioB,
        period_days: periodDays,
      },
      confidence: bestRatio,
      sample_size: pairEps.length,
      observed_from: firstAt,
      observed_to: lastAt,
      last_reinforced_at: lastAt,
    });
  }
  return out;
}

// -------------------------------------------------------------------
// Threshold patterns: numeric summarization for source types that
// carry numeric metadata. The conversation/event episodes we ingest
// today carry no numeric fields, so the function returns an empty
// array. The code path exists so M5/M6 transaction/meal episodes can
// start emitting patterns without revisiting this file's shape.
// -------------------------------------------------------------------

export function detectThresholdPatterns(episodes: EpisodeRow[]): PatternCandidate[] {
  const qualifying = episodes.filter(
    (ep) => ep.source_type === 'transaction' || ep.source_type === 'meal',
  );
  if (qualifying.length === 0) return [];

  // M3.7-A: event/conversation episodes don't carry a numeric value
  // on metadata that we can summarize safely. When we start ingesting
  // transactions (M5) we will read `metadata.amount_usd` or similar
  // and emit a `threshold` pattern per (source_type, merchant).
  // Until then we return [] to keep the callable shape stable.
  return [];
}

export interface PatternCandidate {
  kind: 'temporal' | 'co_occurrence' | 'threshold';
  description: string;
  parameters: Record<string, unknown>;
  confidence: number;
  sample_size: number;
  observed_from: string;
  observed_to: string;
  last_reinforced_at: string;
}

function estimatePeriodDays(episodes: EpisodeRow[]): number {
  if (episodes.length < 2) return 7;
  const first = Date.parse(episodes[0]!.occurred_at);
  const last = Date.parse(episodes[episodes.length - 1]!.occurred_at);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return 7;
  const spanDays = (last - first) / (1000 * 60 * 60 * 24);
  const avg = spanDays / (episodes.length - 1);
  // Clamp to a sane [1d, 90d] range so pattern decay math is stable.
  return Math.max(1, Math.min(90, Math.round(avg)));
}

/**
 * Upsert a single pattern candidate onto `(household_id, kind,
 * description_hash)`. If a matching row exists, its `sample_size`,
 * `observed_to`, `last_reinforced_at`, and `confidence` are updated;
 * otherwise a new row is inserted.
 */
export async function upsertPattern(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  candidate: PatternCandidate,
  log: Logger,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const hash = descriptionHash(candidate.description);
  const parameters = {
    ...candidate.parameters,
    description_hash: hash,
  } as unknown as Json;

  // Look up an existing row. Supabase has no filter on a jsonb field
  // by default via eq chainability for deep keys; we scan by
  // (household_id, kind) and match on the hash in memory. Pattern
  // counts per household are small (O(100s)), so this stays cheap.
  const { data: existingRows, error: exErr } = await supabase
    .schema('mem')
    .from('pattern')
    .select('*')
    .eq('household_id', householdId)
    .eq('kind', candidate.kind);
  if (exErr) throw new Error(`mem.pattern lookup failed: ${exErr.message}`);
  const existing = ((existingRows ?? []) as PatternRow[]).find((row) => {
    const params = row.parameters;
    if (params && typeof params === 'object' && !Array.isArray(params)) {
      return (params as Record<string, unknown>).description_hash === hash;
    }
    return false;
  });

  if (existing) {
    // Update only when something changed — lets tests assert idempotency.
    const sameSample = existing.sample_size === candidate.sample_size;
    const sameObservedTo = existing.observed_to === candidate.observed_to;
    const sameReinforced = existing.last_reinforced_at === candidate.last_reinforced_at;
    const sameConfidence = Math.abs(existing.confidence - candidate.confidence) < 1e-9;
    if (sameSample && sameObservedTo && sameReinforced && sameConfidence) {
      return 'unchanged';
    }
    const { error: upErr } = await supabase
      .schema('mem')
      .from('pattern')
      .update({
        sample_size: candidate.sample_size,
        observed_to: candidate.observed_to,
        last_reinforced_at: candidate.last_reinforced_at,
        confidence: candidate.confidence,
        parameters,
      })
      .eq('id', existing.id);
    if (upErr) {
      log.warn('mem.pattern update failed', { error: upErr.message });
      return 'unchanged';
    }
    return 'updated';
  }

  const insert: PatternInsert = {
    household_id: householdId,
    kind: candidate.kind,
    description: candidate.description,
    parameters,
    confidence: candidate.confidence,
    sample_size: candidate.sample_size,
    observed_from: candidate.observed_from,
    observed_to: candidate.observed_to,
    last_reinforced_at: candidate.last_reinforced_at,
    status: 'active',
  };
  const { error: insErr } = await supabase.schema('mem').from('pattern').insert(insert);
  if (insErr) {
    log.warn('mem.pattern insert failed', { error: insErr.message });
    return 'unchanged';
  }
  return 'inserted';
}

/**
 * Run all structural detectors for a household and upsert the
 * results. Returns the count of rows inserted or updated.
 */
export async function runStructuralPatternPass(
  deps: PatternDetectorDeps,
  householdId: HouseholdId,
): Promise<DetectPatternsResult> {
  const now = (deps.now ?? (() => new Date()))();
  const episodes = await loadEpisodesForHousehold(deps.supabase, householdId, {
    lookbackDays: 90,
    now,
  });

  const candidates: PatternCandidate[] = [
    ...detectTemporalPatterns(episodes),
    ...detectCoOccurrencePatterns(episodes),
    ...detectThresholdPatterns(episodes),
  ];

  let upserts = 0;
  for (const c of candidates) {
    const outcome = await upsertPattern(deps.supabase, householdId, c, deps.log);
    if (outcome !== 'unchanged') upserts += 1;
  }
  return { upserts };
}
