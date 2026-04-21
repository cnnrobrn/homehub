/**
 * `enrichment` handler (M2-B).
 *
 * Consumes `enrich_event` pgmq messages emitted by `sync-gcal`. Each
 * message's envelope references an `app.event` row that landed with
 * `segment='system'` — the not-yet-classified sentinel. This worker:
 *
 *   1. Reads the event row (service-role client; RLS bypassed).
 *   2. Runs the deterministic classifier from `@homehub/enrichment`.
 *   3. Writes the result back to `app.event` (segment + an
 *      `enrichment` sub-object in metadata tagged with the classifier
 *      version so M3's model-backed upgrade can reprocess).
 *   4. Writes an audit row (`event.enriched`).
 *
 * Error policy:
 *   - Row missing → terminal, dead-letter + ack.
 *   - Anything else → terminal, dead-letter + ack.
 *   - No retries at this tier: the classifier is deterministic, so a
 *     repeat attempt on identical input would produce the identical
 *     failure. Retries are a symptom to investigate, not a strategy.
 *
 * Idempotency: re-running on the same event produces the same
 * classification and the same audit diff. The `before` column on the
 * audit row captures whatever segment the event had before this run
 * (may be `'system'` on the first pass, or the same classified value on
 * subsequent passes); the `after` column is the new classification
 * metadata.
 *
 * The model-call path (Kimi K2, `mem.fact_candidate`, etc.) lands in
 * M3 — that's when `generate()` and the `model_calls` ledger get wired
 * in. Today there are no model calls, so there is nothing to log to
 * `model_calls`.
 */

import { type Database, type Json } from '@homehub/db';
import {
  createDeterministicEventClassifier,
  DETERMINISTIC_CLASSIFIER_VERSION,
  type EventClassification,
  type EventClassifier,
  type EventInput,
} from '@homehub/enrichment';
import {
  type Logger,
  type MessageEnvelope,
  type QueueClient,
  queueNames,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

/**
 * Injectable set — every external is a dependency so the unit tests in
 * `handler.test.ts` can stub everything without touching a real
 * Supabase, queue, or classifier.
 */
export interface EnrichmentHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  /** Default: `createDeterministicEventClassifier()`. Tests override. */
  classifier?: EventClassifier;
  /** Default: `() => new Date()`. Tests override for deterministic
   * `updated_at` and audit `at`. */
  now?: () => Date;
}

type EventRow = Database['app']['Tables']['event']['Row'];

/**
 * Shape we persist under `metadata.enrichment`. Readers should treat it
 * as forward-compatible: M3 will add a `model` field and possibly a
 * `prompt_version` field here without bumping the overall event row.
 */
export interface EnrichmentMetadata {
  segment: EventClassification['segment'];
  kind: EventClassification['kind'];
  confidence: number;
  rationale: string;
  signals: string[];
  version: typeof DETERMINISTIC_CLASSIFIER_VERSION;
  at: string;
}

/**
 * Top-level: claim one → process → ack/DLQ. Returns whether we claimed
 * a message so the polling loop in `main.ts` can back off when idle.
 */
export async function pollOnce(deps: EnrichmentHandlerDeps): Promise<'claimed' | 'idle'> {
  const queue = queueNames.enrichEvent;
  const claimed = await deps.queues.claim(queue);
  if (!claimed) return 'idle';

  const log = deps.log.child({
    queue,
    message_id: claimed.messageId,
    household_id: claimed.payload.household_id,
    entity_id: claimed.payload.entity_id,
  });

  try {
    await enrichOne({ ...deps, log }, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('enrichment handler failed; dead-lettering', { error: reason });
    await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }
}

/**
 * Exported for tests: the per-message unit of work, without the
 * queue plumbing.
 */
export async function enrichOne(
  deps: EnrichmentHandlerDeps,
  envelope: MessageEnvelope,
): Promise<void> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const classifier = deps.classifier ?? createDeterministicEventClassifier();

  const row = await loadEvent(supabase, envelope.household_id, envelope.entity_id);
  if (!row) {
    // The sync-gcal handler writes the row before enqueueing, so a miss
    // here means the event was deleted between upsert and claim — or
    // the envelope was hand-produced. Either way there is no
    // downstream work to do, but we surface it as a DLQ entry so
    // operators can investigate.
    throw new Error(`app.event row not found: ${envelope.entity_id}`);
  }

  const input = buildClassifierInput(row);
  const classification = classifier.classify(input);

  const enrichment: EnrichmentMetadata = {
    segment: classification.segment,
    kind: classification.kind,
    confidence: classification.confidence,
    rationale: classification.rationale,
    signals: classification.signals,
    version: DETERMINISTIC_CLASSIFIER_VERSION,
    at: now.toISOString(),
  };

  const before = {
    segment: row.segment,
    metadata_enrichment: getMetadataEnrichment(row.metadata),
  };

  const nextMetadata: Json = {
    ...(isJsonObject(row.metadata) ? row.metadata : {}),
    enrichment: enrichment as unknown as Json,
  };

  const { error: updateError } = await supabase
    .schema('app')
    .from('event')
    .update({
      segment: classification.segment,
      metadata: nextMetadata,
      updated_at: now.toISOString(),
    })
    .eq('id', row.id);
  if (updateError) {
    throw new Error(`app.event update failed: ${updateError.message}`);
  }

  const after = {
    segment: classification.segment,
    metadata_enrichment: enrichment,
  };

  await writeAudit(supabase, {
    household_id: row.household_id,
    action: 'event.enriched',
    resource_id: row.id,
    before,
    after,
  });

  log.info('event enriched', {
    segment: classification.segment,
    kind: classification.kind,
    confidence: classification.confidence,
  });
}

// ---- Helpers -----------------------------------------------------------

async function loadEvent(
  supabase: SupabaseClient<Database>,
  householdId: string,
  id: string,
): Promise<EventRow | null> {
  // Filter on `household_id` as well as `id` so a hand-edited envelope
  // can't steer the worker at a different household's row. The id is a
  // UUID but defense-in-depth beats trust.
  const { data, error } = await supabase
    .schema('app')
    .from('event')
    .select('*')
    .eq('id', id)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw new Error(`app.event lookup failed: ${error.message}`);
  return data;
}

/**
 * Build the classifier input from the event row. Attendees live under
 * `metadata.attendees` per `sync-gcal`'s upsert path. Anything missing
 * falls back to a safe default.
 */
export function buildClassifierInput(row: EventRow): EventInput {
  const metadata = isJsonObject(row.metadata) ? row.metadata : {};
  const attendeesRaw = metadata.attendees;
  const attendees = Array.isArray(attendeesRaw)
    ? attendeesRaw
        .map((a) => normalizeAttendee(a))
        .filter((a): a is { email: string; displayName?: string } => a !== null)
    : [];

  const ownerEmail = typeof metadata.owner_email === 'string' ? metadata.owner_email : '';
  const description = typeof metadata.description === 'string' ? metadata.description : undefined;

  return {
    title: row.title,
    ...(description ? { description } : {}),
    ...(row.location ? { location: row.location } : {}),
    startsAt: row.starts_at,
    ...(row.ends_at ? { endsAt: row.ends_at } : {}),
    allDay: row.all_day,
    attendees,
    ownerEmail,
    ...(row.provider ? { provider: row.provider } : {}),
    metadata,
  };
}

function normalizeAttendee(raw: unknown): { email: string; displayName?: string } | null {
  if (!isJsonObject(raw)) return null;
  const email = raw.email;
  if (typeof email !== 'string' || email.length === 0) return null;
  const displayName = raw.displayName;
  return typeof displayName === 'string' ? { email, displayName } : { email };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getMetadataEnrichment(metadata: Json): unknown {
  if (isJsonObject(metadata)) return metadata.enrichment ?? null;
  return null;
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
  // Best-effort. Audit failures must not fail the business operation —
  // matches the pattern in sync-gcal.
  const { error } = await supabase
    .schema('audit')
    .from('event')
    .insert({
      household_id: input.household_id,
      actor_user_id: null,
      action: input.action,
      resource_type: 'app.event',
      resource_id: input.resource_id,
      before: input.before as Json,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-enrichment] audit write failed: ${error.message}`);
  }
}
