/**
 * `enrich_email` handler (M4-B).
 *
 * Consumes `enrich_email` pgmq messages emitted by `sync-gmail`. Each
 * message's envelope references an `app.email` row. The handler:
 *
 *   1. Reads the email row (DLQ on miss).
 *   2. `withBudgetGuard({ task_class: 'enrichment.email' })`. Budget-
 *      exceeded degrades: skip extraction entirely, log, ack. No model
 *      spend on households that have already blown their budget.
 *   3. Optionally fetches the full email body via
 *      `EmailProvider.fetchFullBody`. When the provider isn't wired or
 *      the full fetch fails, falls back to the stored `body_preview`.
 *      The full body is held in a local variable and never persisted.
 *   4. Builds household context from `mem.node` rosters (people /
 *      places / merchants).
 *   5. Calls the model-backed email extractor.
 *   6. For each episode: resolves `subject_reference` via a node
 *      resolver (creates `needs_review` nodes when needed) and inserts
 *      a `mem.episode` with `source_type='email'`, `source_id=email_id`,
 *      and a `metadata` blob carrying `{kind, attributes, version}`.
 *   7. For each fact: resolves subject + optional object references,
 *      inserts into `mem.fact_candidate` with `source='extraction'` and
 *      `status='pending'`. Runs the reconciler inline.
 *   8. For each `add_to_calendar` suggestion: writes an `app.suggestion`
 *      row with `status='pending'`, a segment chosen by heuristic
 *      (food / fun / social), and `preview` carrying the calendar
 *      fields plus the source email id.
 *   9. Enqueues `node_regen` per touched node and `embed_node` per
 *      newly-created node.
 *  10. Writes an audit row (`mem.email.enriched`).
 *
 * Idempotency:
 *   - Episodes keyed on `(source_type='email', source_id=email_id,
 *     metadata.kind)`. Re-running reinserts; a future migration will
 *     add a unique index. Until then, DB-level dedupe relies on the
 *     reconciler's content-hash and on ops-driven cleanup.
 *   - Fact candidates pass through the standard reconciler which
 *     content-hashes to dedupe (M3.5-B pattern).
 *   - Suggestions dedupe on `(household_id, kind, preview.source_email_id,
 *     preview.starts_at)` — we check before insert.
 *
 * Privacy (spec anchor — `specs/03-integrations/google-workspace.md` §
 * Storage of bodies):
 *   - Full body is ephemeral. Held in a local variable, never logged,
 *     never written to `mem.*` or `audit.*`.
 *   - Evidence strings on facts / episode summaries are truncated to a
 *     short phrase by the model per the prompt contract.
 */

import { type Database, type Json } from '@homehub/db';
import {
  createKimiEmailExtractor,
  EMAIL_EXTRACTOR_PROMPT_VERSION,
  reconcileCandidate,
  type EmailExtractionResult,
  type EmailHouseholdContext,
  type EmailInput,
  type ModelEmailExtractor,
} from '@homehub/enrichment';
import { type EmailProvider } from '@homehub/providers-email';
import { type HouseholdId, type NodeType } from '@homehub/shared';
import {
  queueNames,
  withBudgetGuard,
  type Logger,
  type MessageEnvelope,
  type ModelClient,
  type QueueClient,
  type ServiceSupabaseClient,
} from '@homehub/worker-runtime';
import { type SupabaseClient } from '@supabase/supabase-js';

type EmailRow = Database['app']['Tables']['email']['Row'];
type ConnectionRow = {
  id: string;
  nango_connection_id: string;
};

const MAX_ROSTER_SIZE = 50;

/** Segments supported by `app.suggestion.segment` per migration 0008. */
type Segment = 'financial' | 'food' | 'fun' | 'social' | 'system';

export interface EmailHandlerDeps {
  supabase: SupabaseClient<Database>;
  queues: QueueClient;
  log: Logger;
  /**
   * Required — the email extractor calls a model. When absent, the
   * handler dead-letters messages (operators must notice the misconfig
   * so the queue isn't silently starved).
   */
  modelClient?: ModelClient;
  /**
   * Optional — when wired, the handler pulls the full body on-demand
   * for higher-quality extraction. Falls back to `body_preview` if the
   * provider isn't wired or the call fails.
   */
  emailProvider?: EmailProvider;
  /** Injectable for tests. */
  extractor?: ModelEmailExtractor;
  now?: () => Date;
}

/**
 * Top-level: claim one → process → ack/DLQ. Returns whether we claimed
 * a message so the main loop can back off when idle.
 */
export async function pollOnceEmail(deps: EmailHandlerDeps): Promise<'claimed' | 'idle'> {
  const queue = queueNames.enrichEmail;
  const claimed = await deps.queues.claim(queue);
  if (!claimed) return 'idle';

  const log = deps.log.child({
    queue,
    message_id: claimed.messageId,
    household_id: claimed.payload.household_id,
    entity_id: claimed.payload.entity_id,
  });

  try {
    await enrichEmailOne({ ...deps, log }, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error('enrich_email handler failed; dead-lettering', { error: reason });
    await deps.queues.deadLetter(queue, claimed.messageId, reason, claimed.payload);
    await deps.queues.ack(queue, claimed.messageId);
    return 'claimed';
  }
}

/**
 * Per-message unit of work. Exposed for tests.
 */
export async function enrichEmailOne(
  deps: EmailHandlerDeps,
  envelope: MessageEnvelope,
): Promise<void> {
  const { supabase, log } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const email = await loadEmail(supabase, envelope.household_id, envelope.entity_id);
  if (!email) {
    throw new Error(`app.email row not found: ${envelope.entity_id}`);
  }

  const householdId = email.household_id as HouseholdId;

  // --- Budget guard --------------------------------------------------
  const budget = await withBudgetGuard(
    supabase as unknown as ServiceSupabaseClient,
    { household_id: householdId, task_class: 'enrichment.email' },
    log,
  );
  if (!budget.ok) {
    log.warn('enrich_email: budget exceeded — skipping extraction', {
      email_id: email.id,
      reason: budget.reason,
    });
    await writeAudit(supabase, {
      household_id: householdId,
      action: 'mem.email.skipped',
      resource_id: email.id,
      before: null,
      after: { reason: 'budget_exceeded' },
    });
    return;
  }

  // --- Extractor wiring ----------------------------------------------
  if (!deps.modelClient && !deps.extractor) {
    throw new Error('enrich_email: no modelClient and no extractor injected');
  }
  const extractor =
    deps.extractor ?? createKimiEmailExtractor({ modelClient: deps.modelClient!, log });

  // --- Full-body fetch (ephemeral) -----------------------------------
  // Cache the full body in a local variable; never persist. If the
  // provider is not wired, or the call fails, fall back to the stored
  // body_preview — lower quality but always available.
  let body = email.body_preview ?? '';
  if (deps.emailProvider && email.connection_id) {
    try {
      const connection = await loadConnection(supabase, email.connection_id);
      if (connection) {
        const full = await deps.emailProvider.fetchFullBody({
          connectionId: connection.nango_connection_id,
          messageId: email.source_id,
        });
        if (full.bodyText && full.bodyText.length > 0) {
          body = full.bodyText;
        }
      }
    } catch (err) {
      log.warn('enrich_email: fetchFullBody failed; falling back to body_preview', {
        email_id: email.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Build inputs --------------------------------------------------
  const context = await buildHouseholdContext(supabase, householdId);
  const input: EmailInput = {
    emailId: email.id,
    subject: email.subject ?? '',
    fromEmail: email.from_email ?? '',
    ...(email.from_name ? { fromName: email.from_name } : {}),
    receivedAt: email.received_at,
    categories: email.categories ?? [],
    body,
  };

  // --- Extract -------------------------------------------------------
  let extraction: EmailExtractionResult;
  try {
    extraction = await extractor.extract({ email: input, context });
  } catch (err) {
    throw new Error(`email extractor failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- Write episodes + candidates + suggestions ---------------------
  const touchedNodeIds = new Set<string>();
  const newlyCreatedNodeIds = new Set<string>();
  const candidateIds: string[] = [];
  let episodesWritten = 0;
  let suggestionsWritten = 0;
  let transactionsWritten = 0;

  if (
    extraction.episodes.length > 0 ||
    extraction.facts.length > 0 ||
    extraction.suggestions.length > 0
  ) {
    const resolver = createNodeResolver({
      supabase,
      householdId,
      log,
      newlyCreatedNodeIds,
    });

    // Episodes first — each one binds to a node_id via `subject_reference`.
    for (const ep of extraction.episodes) {
      try {
        const subjectDefaultType = inferDefaultType(ep.kind);
        const subjectNodeId = await resolver.resolve(ep.subject_reference, subjectDefaultType);
        touchedNodeIds.add(subjectNodeId);

        const insert: Database['mem']['Tables']['episode']['Insert'] = {
          household_id: householdId,
          title: ep.title,
          summary: ep.summary,
          occurred_at: ep.occurred_at,
          ended_at: ep.ends_at ?? null,
          place_node_id: subjectDefaultType === 'place' ? subjectNodeId : null,
          participants: subjectDefaultType === 'person' ? [subjectNodeId] : [],
          source_type: 'email',
          source_id: email.id,
          recorded_at: now.toISOString(),
          metadata: {
            kind: ep.kind,
            attributes: ep.attributes,
            subject_reference: ep.subject_reference,
            prompt_version: EMAIL_EXTRACTOR_PROMPT_VERSION,
          } as unknown as Json,
        };
        const { error: epErr } = await supabase.schema('mem').from('episode').insert(insert);
        if (epErr) {
          throw new Error(`mem.episode insert failed: ${epErr.message}`);
        }
        episodesWritten += 1;

        // M5-B cross-cut: receipts also shadow-write into `app.transaction`
        // (`source='email_receipt'`) so the financial reconciler has
        // something to match against provider-side rows.
        if (ep.kind === 'receipt') {
          const wrote = await maybeWriteReceiptTransaction({
            supabase,
            log,
            email,
            episode: ep,
            merchantFallback: await resolveMerchantName(supabase, subjectNodeId),
          });
          if (wrote) transactionsWritten += 1;
        }
      } catch (err) {
        log.warn('enrich_email: episode write failed; skipping', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Facts → mem.fact_candidate (source='extraction', status='pending').
    for (const fact of extraction.facts) {
      try {
        const subjectNodeId = await resolver.resolve(fact.subject, 'merchant');
        const objectNodeId = fact.object_node_reference
          ? await resolver.resolve(fact.object_node_reference, 'merchant')
          : null;
        const validFromIso = fact.valid_from === 'inferred' ? now.toISOString() : fact.valid_from;
        const insert: Database['mem']['Tables']['fact_candidate']['Insert'] = {
          household_id: householdId,
          subject_node_id: subjectNodeId,
          predicate: fact.predicate,
          object_value: (fact.object_value ?? null) as Json,
          object_node_id: objectNodeId,
          confidence: fact.confidence,
          evidence: [
            {
              source_type: 'email',
              source_id: email.id,
              note: fact.evidence,
              prompt_version: EMAIL_EXTRACTOR_PROMPT_VERSION,
            },
          ] as unknown as Json,
          valid_from: validFromIso,
          recorded_at: now.toISOString(),
          source: 'extraction',
          status: 'pending',
        };
        const { data: candRow, error: candErr } = await supabase
          .schema('mem')
          .from('fact_candidate')
          .insert(insert)
          .select('id')
          .single();
        if (candErr || !candRow) {
          throw new Error(`mem.fact_candidate insert failed: ${candErr?.message ?? 'no id'}`);
        }
        candidateIds.push(candRow.id as string);
        touchedNodeIds.add(subjectNodeId);
        if (objectNodeId) touchedNodeIds.add(objectNodeId);
      } catch (err) {
        log.warn('enrich_email: fact candidate write failed; skipping', {
          fact_id: fact.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Reconcile each candidate inline.
    for (const candidateId of candidateIds) {
      try {
        const result = await reconcileCandidate({ supabase, log, now: () => now }, candidateId);
        for (const nodeId of result.touchedNodeIds) touchedNodeIds.add(nodeId);
      } catch (err) {
        log.warn('enrich_email: reconcile failed; candidate stays pending', {
          candidate_id: candidateId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Suggestions → app.suggestion (status='pending'). M4-B only ships
    // `add_to_calendar`; M9's approval flow executes them. We dedupe on
    // (household, kind, source_email_id, starts_at) so replays don't
    // flood the review queue.
    for (const suggestion of extraction.suggestions) {
      try {
        // Skip suggestions whose start is before the email arrived —
        // those are receipts the extractor mis-shaped, not future plans.
        if (new Date(suggestion.starts_at).getTime() < new Date(email.received_at).getTime()) {
          log.warn('enrich_email: suggestion starts_at precedes received_at; skipping', {
            email_id: email.id,
            starts_at: suggestion.starts_at,
            received_at: email.received_at,
          });
          continue;
        }

        const duplicate = await findDuplicateSuggestion(supabase, {
          householdId,
          kind: suggestion.kind,
          emailId: email.id,
          startsAt: suggestion.starts_at,
        });
        if (duplicate) {
          log.debug('enrich_email: duplicate suggestion skipped', {
            email_id: email.id,
            starts_at: suggestion.starts_at,
          });
          continue;
        }

        const segment = pickSuggestionSegment(email, suggestion.title, suggestion.location);
        const preview: Json = {
          starts_at: suggestion.starts_at,
          ...(suggestion.ends_at ? { ends_at: suggestion.ends_at } : {}),
          ...(suggestion.location ? { location: suggestion.location } : {}),
          attendees: suggestion.attendees,
          confidence: suggestion.confidence,
          source_email_id: email.id,
        } as unknown as Json;

        const insert: Database['app']['Tables']['suggestion']['Insert'] = {
          household_id: householdId,
          segment,
          kind: suggestion.kind,
          title: suggestion.title,
          rationale: suggestion.rationale,
          preview,
          status: 'pending',
        };
        const { error: sugErr } = await supabase.schema('app').from('suggestion').insert(insert);
        if (sugErr) {
          throw new Error(`app.suggestion insert failed: ${sugErr.message}`);
        }
        suggestionsWritten += 1;
      } catch (err) {
        log.warn('enrich_email: suggestion write failed; skipping', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // --- Enqueue node_regen + embed_node -------------------------------
  for (const nodeId of touchedNodeIds) {
    try {
      await deps.queues.send(queueNames.nodeRegen, {
        household_id: householdId,
        kind: 'node.regen',
        entity_id: nodeId,
        version: 1,
        enqueued_at: now.toISOString(),
      });
    } catch (err) {
      log.warn('enrich_email: node_regen enqueue failed', {
        node_id: nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  for (const nodeId of newlyCreatedNodeIds) {
    try {
      await deps.queues.send(queueNames.embedNode, {
        household_id: householdId,
        kind: 'node.embed',
        entity_id: nodeId,
        version: 1,
        enqueued_at: now.toISOString(),
      });
    } catch (err) {
      log.warn('enrich_email: embed_node enqueue failed', {
        node_id: nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Audit ---------------------------------------------------------
  await writeAudit(supabase, {
    household_id: householdId,
    action: 'mem.email.enriched',
    resource_id: email.id,
    before: null,
    after: {
      extraction: {
        episodes: episodesWritten,
        facts: extraction.facts.length,
        candidates: candidateIds.length,
        suggestions: suggestionsWritten,
        new_nodes: newlyCreatedNodeIds.size,
        transactions: transactionsWritten,
      },
      prompt_version: EMAIL_EXTRACTOR_PROMPT_VERSION,
      budget_tier: budget.ok ? budget.tier : null,
    },
  });

  log.info('email enriched', {
    email_id: email.id,
    episodes: episodesWritten,
    candidates: candidateIds.length,
    suggestions: suggestionsWritten,
  });
}

// ---- Segment heuristic ------------------------------------------------

/**
 * Pick a segment for an `add_to_calendar` suggestion derived from an
 * email. This is the "segment heuristic" the dispatch calls for:
 *
 *   - Restaurants / dinner / food-service keywords → `'food'`.
 *   - Travel / hotel / airbnb / flight keywords → `'fun'`.
 *   - Everything else → `'social'`.
 *
 * We scan the email categories, the suggestion title, and the location
 * so a single strong signal wins even if one of the inputs is empty.
 */
export function pickSuggestionSegment(
  email: Pick<EmailRow, 'categories' | 'subject'>,
  title: string,
  location: string | undefined,
): Segment {
  const haystack = [...(email.categories ?? []), email.subject ?? '', title, location ?? '']
    .join(' ')
    .toLowerCase();

  if (
    /restaurant|dinner|lunch|brunch|breakfast|cafe|diner|bar|pub|bistro|tasting|opentable|resy/.test(
      haystack,
    )
  ) {
    return 'food';
  }
  if (/travel|hotel|airbnb|flight|airline|trip|vrbo|booking\.com|resort/.test(haystack)) {
    return 'fun';
  }
  return 'social';
}

// ---- Helpers ----------------------------------------------------------

function inferDefaultType(kind: EmailExtractionResult['episodes'][number]['kind']): NodeType {
  switch (kind) {
    case 'receipt':
    case 'bill':
      return 'merchant';
    case 'reservation':
      return 'place';
    case 'invite':
      return 'person';
    case 'shipment':
      // Shipments usually reference `household`; when not, default to merchant.
      return 'merchant';
    default:
      return 'merchant';
  }
}

async function loadEmail(
  supabase: SupabaseClient<Database>,
  householdId: string,
  id: string,
): Promise<EmailRow | null> {
  const { data, error } = await supabase
    .schema('app')
    .from('email')
    .select('*')
    .eq('id', id)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw new Error(`app.email lookup failed: ${error.message}`);
  return data;
}

async function loadConnection(
  supabase: SupabaseClient<Database>,
  connectionId: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .schema('sync')
    .from('provider_connection')
    .select('id, nango_connection_id')
    .eq('id', connectionId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return {
    id: data.id as string,
    nango_connection_id: data.nango_connection_id as string,
  };
}

async function buildHouseholdContext(
  supabase: SupabaseClient<Database>,
  householdId: HouseholdId,
): Promise<EmailHouseholdContext> {
  const [{ data: people }, { data: places }, { data: merchants }] = await Promise.all([
    supabase
      .schema('mem')
      .from('node')
      .select('id, canonical_name')
      .eq('household_id', householdId)
      .eq('type', 'person')
      .limit(MAX_ROSTER_SIZE),
    supabase
      .schema('mem')
      .from('node')
      .select('id, canonical_name')
      .eq('household_id', householdId)
      .eq('type', 'place')
      .limit(MAX_ROSTER_SIZE),
    supabase
      .schema('mem')
      .from('node')
      .select('id, canonical_name')
      .eq('household_id', householdId)
      .eq('type', 'merchant')
      .limit(MAX_ROSTER_SIZE),
  ]);

  return {
    householdId,
    peopleRoster: (people ?? []).map((p) => ({
      id: p.id as string,
      name: p.canonical_name as string,
    })),
    placeRoster: (places ?? []).map((p) => ({
      id: p.id as string,
      name: p.canonical_name as string,
    })),
    merchantRoster: (merchants ?? []).map((p) => ({
      id: p.id as string,
      name: p.canonical_name as string,
    })),
  };
}

/**
 * Return true if an `app.suggestion` row already exists for the
 * (household, kind, source_email_id, starts_at) tuple. Used to dedupe
 * extraction re-runs against the same email.
 */
async function findDuplicateSuggestion(
  supabase: SupabaseClient<Database>,
  args: {
    householdId: HouseholdId;
    kind: string;
    emailId: string;
    startsAt: string;
  },
): Promise<boolean> {
  const { data, error } = await supabase
    .schema('app')
    .from('suggestion')
    .select('id, preview')
    .eq('household_id', args.householdId)
    .eq('kind', args.kind)
    .limit(20);
  if (error) return false;
  for (const row of data ?? []) {
    const preview = row.preview as unknown as {
      source_email_id?: string;
      starts_at?: string;
    } | null;
    if (
      preview &&
      preview.source_email_id === args.emailId &&
      preview.starts_at === args.startsAt
    ) {
      return true;
    }
  }
  return false;
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
      resource_type: 'app.email',
      resource_id: input.resource_id,
      before: input.before as Json,
      after: input.after as Json,
    });
  if (error) {
    console.warn(`[worker-enrichment] email audit write failed: ${error.message}`);
  }
}

// ---- Node resolver (local clone of the event handler's pattern) ------

interface NodeResolver {
  resolve(reference: string, defaultType: NodeType): Promise<string>;
}

function createNodeResolver(opts: {
  supabase: SupabaseClient<Database>;
  householdId: HouseholdId;
  log: Logger;
  newlyCreatedNodeIds: Set<string>;
}): NodeResolver {
  const cache = new Map<string, string>();

  function parseReference(ref: string): { type: NodeType | null; name: string } {
    const match = /^([a-z_]+):(.+)$/.exec(ref.trim());
    if (match) {
      const rawType = match[1]!;
      const name = match[2]!.trim();
      if (isValidNodeType(rawType)) return { type: rawType, name };
    }
    return { type: null, name: ref.trim() };
  }

  return {
    async resolve(ref: string, defaultType: NodeType): Promise<string> {
      const cached = cache.get(ref);
      if (cached) return cached;

      const { type, name } = parseReference(ref);
      // `household` isn't a real node type; pin to a household-scoped
      // placeholder node of the default type. The spec's intent for
      // `subject:'household'` is "this is a property of the whole
      // household" — we still write it as a fact against a stable node
      // so the reconciler can uniquely key it. Convention: use a node
      // of type `category` named `household` for these.
      const resolvedType: NodeType =
        name.toLowerCase() === 'household' && type === null ? 'category' : (type ?? defaultType);
      const canonical =
        resolvedType === 'category' && name.toLowerCase() === 'household' ? 'household' : name;

      const { data: existing, error: exErr } = await opts.supabase
        .schema('mem')
        .from('node')
        .select('id')
        .eq('household_id', opts.householdId)
        .eq('type', resolvedType)
        .ilike('canonical_name', canonical.toLowerCase())
        .limit(1);
      if (exErr) {
        opts.log.warn('resolver: node lookup failed', { error: exErr.message });
      }
      if (existing && existing.length > 0) {
        const id = existing[0]!.id as string;
        cache.set(ref, id);
        return id;
      }

      const { data: aliasRows, error: aliasErr } = await opts.supabase
        .schema('mem')
        .from('alias')
        .select('node_id')
        .eq('household_id', opts.householdId)
        .ilike('alias', canonical.toLowerCase())
        .limit(1);
      if (aliasErr) {
        opts.log.warn('resolver: alias lookup failed', { error: aliasErr.message });
      }
      if (aliasRows && aliasRows.length > 0) {
        const id = aliasRows[0]!.node_id as string;
        cache.set(ref, id);
        return id;
      }

      const insert: Database['mem']['Tables']['node']['Insert'] = {
        household_id: opts.householdId,
        type: resolvedType,
        canonical_name: canonical,
        needs_review: true,
        metadata: { created_by: 'enrichment.email', reference: ref } as unknown as Json,
      };
      const { data: created, error: crErr } = await opts.supabase
        .schema('mem')
        .from('node')
        .insert(insert)
        .select('id')
        .single();
      if (crErr || !created) {
        throw new Error(`resolver: node insert failed: ${crErr?.message ?? 'no id'}`);
      }
      const id = created.id as string;
      opts.newlyCreatedNodeIds.add(id);
      cache.set(ref, id);
      return id;
    },
  };
}

function isValidNodeType(raw: string): raw is NodeType {
  return [
    'person',
    'place',
    'merchant',
    'dish',
    'ingredient',
    'topic',
    'event_type',
    'subscription',
    'account',
    'category',
  ].includes(raw);
}

// ---- Receipt → app.transaction shadow write (M5-B) --------------------

/**
 * Write (or skip) a `source='email_receipt'` row for a receipt episode.
 *
 * Idempotency: we dedupe on `(household_id, source='email_receipt',
 * source_id=email.id)` before inserting. Replays therefore do not
 * double-write.
 *
 * Sign convention: receipts are outflows by default → negative cents.
 * If the extractor signalled `attributes.refund = true` (the v2 prompt
 * emits this for refund copy), we flip to positive.
 *
 * Returns `true` when a row was inserted, `false` otherwise (missing
 * amount, duplicate, error — each is logged as a warning at this layer
 * because they're not fatal to the enrichment pass).
 */
async function maybeWriteReceiptTransaction(args: {
  supabase: SupabaseClient<Database>;
  log: Logger;
  email: EmailRow;
  episode: EmailExtractionResult['episodes'][number];
  merchantFallback: string | null;
}): Promise<boolean> {
  const { supabase, log, email, episode, merchantFallback } = args;

  const attrs = (episode.attributes ?? {}) as Record<string, unknown>;
  const rawAmount = attrs.amount_cents;
  if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount) || rawAmount === 0) {
    log.debug('enrich_email: receipt missing amount_cents; skipping transaction write', {
      email_id: email.id,
    });
    return false;
  }

  // Deduplicate on the natural key used by the sync + reconciler paths.
  const { data: existing, error: exErr } = await supabase
    .schema('app')
    .from('transaction')
    .select('id')
    .eq('household_id', email.household_id)
    .eq('source', 'email_receipt')
    .eq('source_id', email.id)
    .limit(1);
  if (exErr) {
    log.warn('enrich_email: receipt dedupe lookup failed', { error: exErr.message });
    return false;
  }
  if ((existing ?? []).length > 0) {
    log.debug('enrich_email: receipt transaction already exists; skipping', {
      email_id: email.id,
    });
    return false;
  }

  const refund = attrs.refund === true;
  const amountAbs = Math.abs(Math.round(rawAmount));
  const amountCents = refund ? amountAbs : -amountAbs;
  const currency = typeof attrs.currency === 'string' ? attrs.currency : 'USD';
  const merchantRaw =
    typeof attrs.merchant === 'string' && attrs.merchant.trim().length > 0
      ? attrs.merchant.trim()
      : merchantFallback;
  const category = typeof attrs.category === 'string' ? attrs.category : null;

  const insert: Database['app']['Tables']['transaction']['Insert'] = {
    household_id: email.household_id,
    member_id: email.member_id,
    account_id: null,
    occurred_at: episode.occurred_at,
    amount_cents: amountCents,
    currency,
    merchant_raw: merchantRaw,
    category,
    source: 'email_receipt',
    source_id: email.id,
    source_version: email.source_version ?? null,
    metadata: {
      status: 'unmatched',
      source_email_id: email.id,
      extracted_from: 'email_receipt_extraction',
    } as unknown as Json,
  };

  const { error: insErr } = await supabase.schema('app').from('transaction').insert(insert);
  if (insErr) {
    log.warn('enrich_email: app.transaction insert failed', { error: insErr.message });
    return false;
  }
  return true;
}

/**
 * Resolve the canonical name of a node id for use as the fallback
 * `merchant_raw` when the extractor's `attributes.merchant` is missing.
 */
async function resolveMerchantName(
  supabase: SupabaseClient<Database>,
  nodeId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .schema('mem')
    .from('node')
    .select('canonical_name')
    .eq('id', nodeId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.canonical_name as string) ?? null;
}
