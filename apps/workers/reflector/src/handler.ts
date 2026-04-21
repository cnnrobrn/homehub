/**
 * `reflector` handler — M3.7-A real implementation.
 *
 * Weekly reflection pass per household:
 *
 *   1. Idempotency: if `mem.insight` already exists for `(household_id,
 *      week_start)`, skip — the week has already been reflected on.
 *   2. Pull a 7-day window of `mem.episode` rows anchored at
 *      `week_start`. Require ≥ MIN_EPISODES_PER_WEEK episodes before we
 *      spend a model call; small weeks yield weak reflections and the
 *      cost isn't worth it.
 *   3. Pull `mem.fact_candidate` + `mem.fact` rows recorded in the
 *      same window, plus `mem.pattern` rows that are active this week
 *      (last_reinforced_at >= week_start OR observed_to >= week_start).
 *   4. `withBudgetGuard({ task_class: 'reflection' })`. Reflection is
 *      among the first workloads to degrade when a household is near
 *      cap; skip cleanly on budget_exceeded.
 *   5. Render the `reflection/weekly` prompt, call the model at
 *      `temperature: 0.5, maxOutputTokens: 1500, cache: 'auto'`.
 *   6. Insert `mem.insight` with a trailing machine-readable citation
 *      footnote (the table has no `metadata` column; the footnote is
 *      an HTML comment so rendered output stays clean). Also write
 *      `audit.event` with the full citation blob and model cost.
 *
 * Cost discipline:
 *   - MIN_EPISODES_PER_WEEK (5) avoids spending on vacuous weeks.
 *   - `withBudgetGuard` per-household — a saturated household gets
 *     skipped cleanly; the cron picks them up next week.
 */

import { type Database, type Json } from '@homehub/db';
import {
  loadPrompt,
  renderPrompt,
  weeklyReflectionSchema,
  type WeeklyReflectionResponse,
} from '@homehub/prompts';
import { type HouseholdId } from '@homehub/shared';
import {
  NotYetImplementedError,
  withBudgetGuard,
  type Logger,
  type ModelClient,
  type ServiceSupabaseClient,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

type EpisodeRow = Database['mem']['Tables']['episode']['Row'];
type FactRow = Database['mem']['Tables']['fact']['Row'];
type FactCandidateRow = Database['mem']['Tables']['fact_candidate']['Row'];
type PatternRow = Database['mem']['Tables']['pattern']['Row'];
type InsightRow = Database['mem']['Tables']['insight']['Row'];

/** Prompt version pinned here so the audit row can record which prompt produced the insight. */
export const REFLECTION_PROMPT_VERSION = '2026-04-20-reflection-v1';

/** Below this, reflection is too thin to be useful; skip the model call. */
export const MIN_EPISODES_PER_WEEK = 5;

/** Cap on the number of episodes passed into the prompt — keeps context bounded. */
export const MAX_EPISODES_PER_PROMPT = 60;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReflectorDeps {
  supabase: SupabaseClient<Database>;
  log: Logger;
  /** Required — the reflector always calls the model when it runs. */
  modelClient: ModelClient;
  now?: () => Date;
}

export interface RunReflectorOptions {
  /**
   * When empty / omitted, iterates every household in `app.household`.
   * When set, only the listed households are processed.
   */
  householdIds?: HouseholdId[];
  /**
   * ISO date (`YYYY-MM-DD`) for the Monday anchoring the reflection
   * window. When omitted, defaults to the most recent Monday (UTC).
   */
  weekStart?: string;
}

export interface RunReflectorReport {
  /** Insight rows written. */
  inserted: number;
  /**
   * Households that were skipped for any reason (idempotency,
   * insufficient episodes, budget exceeded, no households, or a
   * per-household error).
   */
  skipped: number;
}

export async function runReflector(
  deps: ReflectorDeps,
  opts: RunReflectorOptions = {},
): Promise<RunReflectorReport> {
  const report: RunReflectorReport = { inserted: 0, skipped: 0 };
  const weekStart = opts.weekStart ?? mostRecentMondayUtc(deps.now?.() ?? new Date());

  const households = opts.householdIds?.length
    ? opts.householdIds
    : await loadAllHouseholdIds(deps.supabase);

  if (households.length === 0) {
    return report;
  }

  for (const householdId of households) {
    try {
      const perHousehold = await runHouseholdReflection(deps, householdId, weekStart);
      if (perHousehold.inserted) report.inserted += 1;
      else report.skipped += 1;
    } catch (err) {
      deps.log.error('reflector: household run failed', {
        household_id: householdId,
        error: err instanceof Error ? err.message : String(err),
      });
      report.skipped += 1;
    }
  }

  return report;
}

interface HouseholdReflectionResult {
  inserted: boolean;
  /** `'already_reflected' | 'insufficient_episodes' | 'budget_exceeded' | 'model_no_output' | 'ok'`. */
  reason: string;
}

async function runHouseholdReflection(
  deps: ReflectorDeps,
  householdId: HouseholdId,
  weekStart: string,
): Promise<HouseholdReflectionResult> {
  const log = deps.log.child({ household_id: householdId, week_start: weekStart });
  const now = (deps.now ?? (() => new Date()))();
  const { startIso, endIso, endDate } = weekBoundsFromStart(weekStart);

  // 1. Idempotency gate.
  const existingInsight = await loadExistingInsight(deps.supabase, householdId, weekStart);
  if (existingInsight) {
    log.info('reflector: insight already exists for week; skipping', {
      insight_id: existingInsight.id,
    });
    return { inserted: false, reason: 'already_reflected' };
  }

  // 2. Episode window.
  const episodes = await loadEpisodesForWeek(deps.supabase, householdId, startIso, endIso);
  if (episodes.length < MIN_EPISODES_PER_WEEK) {
    log.info('reflector: insufficient episodes for reflection; skipping', {
      episode_count: episodes.length,
      min: MIN_EPISODES_PER_WEEK,
    });
    return { inserted: false, reason: 'insufficient_episodes' };
  }

  // 3. Facts + patterns.
  const [candidates, canonicalFacts, patterns] = await Promise.all([
    loadFactCandidatesForWeek(deps.supabase, householdId, startIso, endIso),
    loadCanonicalFactsForWeek(deps.supabase, householdId, startIso, endIso),
    loadActivePatternsSince(deps.supabase, householdId, startIso),
  ]);

  // 4. Budget guard.
  const budget = await withBudgetGuard(
    deps.supabase as unknown as ServiceSupabaseClient,
    { household_id: householdId, task_class: 'reflection' },
    log,
  );
  if (!budget.ok) {
    log.warn('reflector: budget exceeded; skipping reflection');
    return { inserted: false, reason: 'budget_exceeded' };
  }

  // 5. Model call.
  const prompt = loadPrompt('reflection/weekly');
  const rendered = renderPrompt(prompt, {
    household_context: summarizeHousehold(householdId),
    week_start: weekStart,
    week_end: endDate.toISOString().slice(0, 10),
    episodes: formatEpisodes(episodes),
    new_facts: formatFacts(candidates, canonicalFacts),
    patterns: formatPatterns(patterns),
  });

  const result = await deps.modelClient.generate({
    task: 'reflection.weekly',
    household_id: householdId,
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.userPrompt,
    schema: weeklyReflectionSchema,
    temperature: 0.5,
    maxOutputTokens: 1500,
    cache: 'auto',
  });
  const parsed = result.parsed as WeeklyReflectionResponse | undefined;
  if (!parsed) {
    log.warn('reflector: model returned no parsed output');
    return { inserted: false, reason: 'model_no_output' };
  }
  if (
    parsed.cited_episodes.length === 0 &&
    parsed.cited_facts.length === 0 &&
    parsed.cited_patterns.length === 0
  ) {
    // The schema permits empty citations (quiet-week example in the
    // prompt). Log at info so operators can spot drift but don't fail.
    log.info('reflector: model produced reflection with no citations');
  }

  // 6. Insert insight + audit.
  const bodyMdWithFootnote = appendCitationFootnote(parsed, weekStart);
  const insightInsert: Database['mem']['Tables']['insight']['Insert'] = {
    household_id: householdId,
    week_start: weekStart,
    body_md: bodyMdWithFootnote,
  };
  const { data: insightRow, error: insertErr } = await deps.supabase
    .schema('mem')
    .from('insight')
    .insert(insightInsert)
    .select('id')
    .single();
  if (insertErr || !insightRow) {
    throw new Error(`mem.insight insert failed: ${insertErr?.message ?? 'no id'}`);
  }

  await writeAudit(deps.supabase, {
    household_id: householdId,
    action: 'mem.reflection.completed',
    resource_id: insightRow.id as string,
    before: null,
    after: {
      week_start: weekStart,
      cited_episodes: parsed.cited_episodes,
      cited_facts: parsed.cited_facts,
      cited_patterns: parsed.cited_patterns,
      prompt_version: REFLECTION_PROMPT_VERSION,
      model: result.model,
      cost_usd: result.costUsd,
      at: now.toISOString(),
    },
  });

  log.info('reflector: insight written', {
    insight_id: insightRow.id,
    cited_episodes: parsed.cited_episodes.length,
    cited_facts: parsed.cited_facts.length,
    cited_patterns: parsed.cited_patterns.length,
    cost_usd: result.costUsd,
  });
  return { inserted: true, reason: 'ok' };
}

// -----------------------------------------------------------------
// Time helpers
// -----------------------------------------------------------------

/**
 * Returns the ISO date (`YYYY-MM-DD`) of the most recent Monday in UTC
 * anchored at `now`. If `now` is already a Monday, returns that same
 * Monday's date (not the prior week's). Exposed for tests.
 */
export function mostRecentMondayUtc(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  // JS getUTCDay(): 0 = Sunday, 1 = Monday ... 6 = Saturday.
  const day = d.getUTCDay();
  // Offset back to Monday: Sunday(0) -> 6, Monday(1) -> 0, Tuesday(2) -> 1 ...
  const offset = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function weekBoundsFromStart(weekStart: string): {
  startIso: string;
  endIso: string;
  endDate: Date;
} {
  // `weekStart` is a calendar date; anchor the window at UTC 00:00:00.
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`reflector: invalid week_start: ${weekStart}`);
  }
  const end = new Date(start.getTime() + WEEK_MS);
  return { startIso: start.toISOString(), endIso: end.toISOString(), endDate: end };
}

// -----------------------------------------------------------------
// Supabase loaders
// -----------------------------------------------------------------

async function loadAllHouseholdIds(supabase: SupabaseClient<Database>): Promise<HouseholdId[]> {
  const { data, error } = await supabase.schema('app').from('household').select('id');
  if (error) throw new Error(`app.household load failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as HouseholdId);
}

async function loadExistingInsight(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  weekStart: string,
): Promise<Pick<InsightRow, 'id'> | null> {
  const { data, error } = await supabase
    .schema('mem')
    .from('insight')
    .select('id')
    .eq('household_id', householdId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) throw new Error(`mem.insight load failed: ${error.message}`);
  return (data as Pick<InsightRow, 'id'> | null) ?? null;
}

async function loadEpisodesForWeek(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  startIso: string,
  endIso: string,
): Promise<EpisodeRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('episode')
    .select('*')
    .eq('household_id', householdId)
    .gte('occurred_at', startIso)
    .lt('occurred_at', endIso)
    .order('occurred_at', { ascending: false })
    .limit(MAX_EPISODES_PER_PROMPT);
  if (error) throw new Error(`mem.episode load failed: ${error.message}`);
  return (data ?? []) as EpisodeRow[];
}

async function loadFactCandidatesForWeek(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  startIso: string,
  endIso: string,
): Promise<FactCandidateRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('fact_candidate')
    .select('*')
    .eq('household_id', householdId)
    .gte('recorded_at', startIso)
    .lt('recorded_at', endIso);
  if (error) throw new Error(`mem.fact_candidate load failed: ${error.message}`);
  return (data ?? []) as FactCandidateRow[];
}

async function loadCanonicalFactsForWeek(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  startIso: string,
  endIso: string,
): Promise<FactRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('fact')
    .select('*')
    .eq('household_id', householdId)
    .gte('recorded_at', startIso)
    .lt('recorded_at', endIso);
  if (error) throw new Error(`mem.fact load failed: ${error.message}`);
  return (data ?? []) as FactRow[];
}

/**
 * Active patterns = last_reinforced_at >= week_start OR observed_to >=
 * week_start. Supabase's OR-across-columns filter is exposed via
 * `.or()` with a comma-separated expression.
 */
async function loadActivePatternsSince(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
  startIso: string,
): Promise<PatternRow[]> {
  const { data, error } = await supabase
    .schema('mem')
    .from('pattern')
    .select('*')
    .eq('household_id', householdId)
    .or(`last_reinforced_at.gte.${startIso},observed_to.gte.${startIso}`);
  if (error) throw new Error(`mem.pattern load failed: ${error.message}`);
  return (data ?? []) as PatternRow[];
}

// -----------------------------------------------------------------
// Prompt formatters
// -----------------------------------------------------------------

function summarizeHousehold(householdId: HouseholdId): string {
  return `Household ${householdId}; running weekly reflection.`;
}

function formatEpisodes(episodes: EpisodeRow[]): string {
  if (episodes.length === 0) return '(none)';
  return episodes
    .map(
      (e) =>
        `- [${e.id}] ${e.occurred_at} — ${e.title}${e.summary ? `: ${e.summary.slice(0, 200)}` : ''} (participants: ${e.participants.length}, source=${e.source_type})`,
    )
    .join('\n');
}

function formatFacts(candidates: FactCandidateRow[], canonicalFacts: FactRow[]): string {
  const parts: string[] = [];
  if (candidates.length > 0) {
    parts.push('Candidates (pending / reviewed this week):');
    for (const c of candidates) {
      const obj = formatObject(c.object_value, c.object_node_id);
      const conf = c.confidence == null ? 'n/a' : c.confidence.toFixed(2);
      parts.push(
        `- [${c.id}] ${c.predicate} -> ${obj} (status=${c.status}, confidence ${conf}, source ${c.source})`,
      );
    }
  }
  if (canonicalFacts.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('Canonical facts recorded this week:');
    for (const f of canonicalFacts) {
      const obj = formatObject(f.object_value, f.object_node_id);
      parts.push(
        `- [${f.id}] ${f.predicate} -> ${obj} (confidence ${f.confidence.toFixed(2)}, reinforced ${f.reinforcement_count}x)`,
      );
    }
  }
  if (parts.length === 0) return '(none)';
  return parts.join('\n');
}

function formatObject(objectValue: Json | null, objectNodeId: string | null): string {
  if (objectValue != null) return JSON.stringify(objectValue);
  if (objectNodeId) return `node:${objectNodeId}`;
  return '(null)';
}

function formatPatterns(patterns: PatternRow[]): string {
  if (patterns.length === 0) return '(none)';
  return patterns
    .map(
      (p) =>
        `- [${p.id}] (${p.kind}, status=${p.status}) ${p.description} — sample=${p.sample_size}, confidence ${p.confidence.toFixed(2)}, reinforced ${p.last_reinforced_at}`,
    )
    .join('\n');
}

// -----------------------------------------------------------------
// Citation persistence
// -----------------------------------------------------------------

/**
 * `mem.insight` has no `metadata` column (migration 0011), so the
 * cited-id lists + prompt version ride inside `body_md` as a trailing
 * HTML comment. HTML comments are ignored by markdown renderers, so
 * member-facing output is unaffected; downstream consumers (rule
 * promotion, tests) can parse the footnote for traceability.
 */
export function appendCitationFootnote(
  parsed: WeeklyReflectionResponse,
  weekStart: string,
): string {
  const footnote = {
    version: REFLECTION_PROMPT_VERSION,
    week_start: weekStart,
    cited_episodes: parsed.cited_episodes,
    cited_facts: parsed.cited_facts,
    cited_patterns: parsed.cited_patterns,
  };
  return `${parsed.body_md.trimEnd()}\n\n<!-- homehub:reflection ${JSON.stringify(footnote)} -->\n`;
}

async function writeAudit(
  supabase: SupabaseClient<Database>,
  input: {
    household_id: string;
    action: string;
    resource_id: string;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  const { error } = await supabase
    .schema('audit')
    .from('event')
    .insert({
      household_id: input.household_id,
      actor_user_id: null,
      action: input.action,
      resource_type: 'mem.insight',
      resource_id: input.resource_id,
      before: input.before as Json,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-reflector] audit write failed: ${error.message}`);
  }
}

// Preserve the M0 export name so the stub test stays meaningful. The
// new API is `runReflector`; `handler` is kept only so existing imports
// don't break, and throws if someone calls it directly.
export async function handler(): Promise<void> {
  throw new NotYetImplementedError(
    'reflector handler() is not used at M3.7 — call runReflector() instead.',
  );
}
