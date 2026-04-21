/**
 * Unit tests for the M4-B `enrich_email` handler.
 *
 * Covers the load-bearing paths:
 *   - Happy-path reservation → 1 episode + 1 candidate + 1 suggestion.
 *   - Receipt → episode + candidate, no suggestion.
 *   - Empty extraction → audit only.
 *   - Budget exceeded → skip extraction, log audit, ack.
 *   - Missing email row → throw (DLQ).
 *   - Extractor failure → throw (DLQ).
 *   - Idempotent re-run does not double-insert suggestions.
 *   - Segment heuristic picks food / fun / social from email signals.
 */

import { type EmailExtractionResult, type ModelEmailExtractor } from '@homehub/enrichment';
import { type Logger, type MessageEnvelope, type QueueClient } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enrichEmailOne, pickSuggestionSegment } from './email-handler.js';

import type { Database } from '@homehub/db';

type EmailRow = Database['app']['Tables']['email']['Row'];

function makeLog(): Logger {
  const noop = () => {};
  const base = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => base,
  } as Logger;
  return base;
}

interface SupabaseState {
  emailRow: EmailRow | null;
  householdSettings: Record<string, unknown>;
  modelCallRows: Array<{ cost_usd: number }>;
  existingSuggestions: Array<{ id: string; preview: Record<string, unknown>; kind: string }>;
  existingTransactions: Array<{
    id: string;
    household_id: string;
    source: string;
    source_id: string;
  }>;
  nodes: Array<{ id: string; canonical_name: string; type: string; household_id: string }>;
  episodeInserts: Array<Record<string, unknown>>;
  candidateInserts: Array<Record<string, unknown>>;
  suggestionInserts: Array<Record<string, unknown>>;
  nodeInserts: Array<Record<string, unknown>>;
  auditInserts: Array<Record<string, unknown>>;
  transactionInserts: Array<Record<string, unknown>>;
  factCandidates: Map<string, Record<string, unknown>>;
  facts: Map<string, Record<string, unknown>>;
}

function makeSupabase(init: Partial<SupabaseState> = {}) {
  const state: SupabaseState = {
    emailRow: init.emailRow ?? null,
    householdSettings: init.householdSettings ?? {},
    modelCallRows: init.modelCallRows ?? [],
    existingSuggestions: init.existingSuggestions ?? [],
    existingTransactions: init.existingTransactions ?? [],
    nodes: init.nodes ?? [],
    episodeInserts: [],
    candidateInserts: [],
    suggestionInserts: [],
    nodeInserts: [],
    auditInserts: [],
    transactionInserts: [],
    factCandidates: new Map(),
    facts: new Map(),
  };

  let candidateId = 1;
  let nodeId = 1;

  function appSchema(table: string) {
    if (table === 'email') {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        async maybeSingle() {
          if (!state.emailRow) return { data: null, error: null };
          return { data: state.emailRow, error: null };
        },
      };
      return chain;
    }
    if (table === 'household') {
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        async maybeSingle() {
          return { data: { settings: state.householdSettings }, error: null };
        },
      };
      return chain;
    }
    if (table === 'model_calls') {
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        gte() {
          return chain;
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        return Promise.resolve(fulfill({ data: state.modelCallRows, error: null }));
      };
      return chain;
    }
    if (table === 'suggestion') {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        limit() {
          return chain;
        },
        insert(p: Record<string, unknown>) {
          state.suggestionInserts.push(p);
          state.existingSuggestions.push({
            id: `sug-${state.suggestionInserts.length}`,
            preview: (p.preview as Record<string, unknown>) ?? {},
            kind: p.kind as string,
          });
          return Promise.resolve({ data: null, error: null });
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        let rows = state.existingSuggestions.slice();
        if (filters.kind) rows = rows.filter((r) => r.kind === filters.kind);
        return Promise.resolve(fulfill({ data: rows, error: null }));
      };
      return chain;
    }
    if (table === 'transaction') {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        limit() {
          return chain;
        },
        insert(p: Record<string, unknown>) {
          state.transactionInserts.push(p);
          state.existingTransactions.push({
            id: `tx-${state.transactionInserts.length}`,
            household_id: p.household_id as string,
            source: p.source as string,
            source_id: p.source_id as string,
          });
          return Promise.resolve({ data: null, error: null });
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        let rows = state.existingTransactions.slice();
        for (const [k, v] of Object.entries(filters)) {
          rows = rows.filter((r) => (r as Record<string, unknown>)[k] === v);
        }
        return Promise.resolve(fulfill({ data: rows, error: null }));
      };
      return chain;
    }
    throw new Error(`unexpected app.${table}`);
  }

  function syncSchema(table: string) {
    if (table === 'provider_connection') {
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        async maybeSingle() {
          return {
            data: { id: 'conn-1', nango_connection_id: 'nango-conn-1' },
            error: null,
          };
        },
      };
      return chain;
    }
    throw new Error(`unexpected sync.${table}`);
  }

  function memSchema(table: string) {
    if (table === 'node') {
      const filters: Record<string, unknown> = {};
      let ilikePattern: { col: string; val: string } | null = null;
      let insertPayload: Record<string, unknown> | undefined;
      let limit: number | undefined;
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        ilike(col: string, val: string) {
          ilikePattern = { col, val };
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        insert(payload: Record<string, unknown>) {
          insertPayload = payload;
          state.nodeInserts.push(payload);
          return chain;
        },
        single() {
          const id = `node-${nodeId++}`;
          state.nodes.push({
            id,
            canonical_name: insertPayload!.canonical_name as string,
            type: insertPayload!.type as string,
            household_id: insertPayload!.household_id as string,
          });
          return Promise.resolve({ data: { id }, error: null });
        },
        async maybeSingle() {
          let rows = state.nodes.slice();
          for (const [k, v] of Object.entries(filters)) {
            rows = rows.filter((r) => (r as Record<string, unknown>)[k] === v);
          }
          const hit = rows[0];
          if (!hit) return { data: null, error: null };
          return {
            data: { canonical_name: hit.canonical_name, id: hit.id },
            error: null,
          };
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
        let rows = state.nodes.slice();
        for (const [k, v] of Object.entries(filters)) {
          rows = rows.filter((r) => (r as Record<string, unknown>)[k] === v);
        }
        if (ilikePattern) {
          const target = ilikePattern.val.toLowerCase();
          rows = rows.filter(
            (r) =>
              ((r as Record<string, unknown>)[ilikePattern!.col] as string).toLowerCase() ===
              target,
          );
        }
        if (limit != null) rows = rows.slice(0, limit);
        return Promise.resolve(fulfill({ data: rows.map((r) => ({ id: r.id })), error: null }));
      };
      return chain;
    }
    if (table === 'alias') {
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        ilike() {
          return chain;
        },
        limit() {
          return chain;
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) =>
        Promise.resolve(fulfill({ data: [], error: null }));
      return chain;
    }
    if (table === 'episode') {
      return {
        insert(p: Record<string, unknown>) {
          state.episodeInserts.push(p);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    if (table === 'fact_candidate') {
      let insertPayload: Record<string, unknown> | undefined;
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        insert(p: Record<string, unknown>) {
          insertPayload = p;
          state.candidateInserts.push(p);
          return chain;
        },
        select() {
          return chain;
        },
        async single() {
          const id = `cand-${candidateId++}`;
          state.factCandidates.set(id, {
            id,
            ...(insertPayload as object),
            status: 'pending',
          });
          return { data: { id }, error: null };
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        update(p: Record<string, unknown>) {
          const id = filters.id as string;
          const current = state.factCandidates.get(id);
          if (current) state.factCandidates.set(id, { ...current, ...p });
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        async maybeSingle() {
          const id = filters.id as string;
          return { data: state.factCandidates.get(id) ?? null, error: null };
        },
      };
      return chain;
    }
    if (table === 'fact') {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        is(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        limit() {
          return chain;
        },
        update() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
      (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) =>
        Promise.resolve(fulfill({ data: [], error: null }));
      return chain;
    }
    throw new Error(`unexpected mem.${table}`);
  }

  function auditSchema(_table: string) {
    return {
      insert(row: Record<string, unknown>) {
        state.auditInserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  const supabase = {
    schema(name: string) {
      if (name === 'app') return { from: (t: string) => appSchema(t) };
      if (name === 'mem') return { from: (t: string) => memSchema(t) };
      if (name === 'sync') return { from: (t: string) => syncSchema(t) };
      if (name === 'audit') return { from: (t: string) => auditSchema(t) };
      throw new Error(`unexpected schema ${name}`);
    },
  };
  return { supabase, state };
}

function makeQueues() {
  const sent: Array<{ queue: string; payload: MessageEnvelope }> = [];
  const queues: QueueClient = {
    claim: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    send: vi.fn(async (queue, payload) => {
      sent.push({ queue, payload });
      return 1;
    }),
    sendBatch: vi.fn(),
    deadLetter: vi.fn(),
    depth: vi.fn(),
    ageOfOldestSec: vi.fn(),
  } as unknown as QueueClient;
  return { queues, sent };
}

// ---- Fixtures ---------------------------------------------------------

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const EMAIL_ID = '40000000-0000-4000-8000-000000000001';

function emailRow(overrides: Partial<EmailRow> = {}): EmailRow {
  return {
    id: EMAIL_ID,
    household_id: HOUSEHOLD_ID,
    member_id: null,
    connection_id: null,
    provider: 'gmail',
    source_id: 'gmail-msg-1',
    source_version: '1234',
    thread_id: 'thread-1',
    subject: "You're confirmed — Dinner at Giulia's",
    from_email: 'noreply@opentable.com',
    from_name: 'OpenTable',
    to_emails: ['alice@example.com'],
    received_at: '2026-04-21T18:04:00Z',
    categories: ['reservation'],
    body_preview: "Your reservation at Giulia's for 4 is confirmed for Saturday.",
    has_attachments: false,
    labels: ['INBOX'],
    metadata: {},
    segment: 'system',
    created_at: '2026-04-21T18:04:01Z',
    updated_at: '2026-04-21T18:04:01Z',
    ...overrides,
  };
}

function envelope(): MessageEnvelope {
  return {
    household_id: HOUSEHOLD_ID,
    kind: 'enrich.email',
    entity_id: EMAIL_ID,
    version: 1,
    enqueued_at: '2026-04-21T18:04:02Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Tests ------------------------------------------------------------

describe('pickSuggestionSegment', () => {
  it('picks food for restaurant / dinner signals', () => {
    expect(
      pickSuggestionSegment(
        { categories: ['reservation'], subject: 'Dinner at Giulia' },
        "Dinner at Giulia's",
        "Giulia's, Cambridge",
      ),
    ).toBe('food');
  });
  it('picks fun for travel / hotel signals', () => {
    expect(
      pickSuggestionSegment(
        { categories: ['reservation'], subject: 'Your Airbnb is confirmed' },
        'Stay at Maplewood Cottage',
        'Maplewood Cottage, Stowe VT',
      ),
    ).toBe('fun');
  });
  it('picks social for generic invites', () => {
    expect(
      pickSuggestionSegment(
        { categories: ['invite'], subject: 'Lunch with the Garcias?' },
        'Lunch with the Garcias',
        undefined,
      ),
    ).toBe('food');
    expect(
      pickSuggestionSegment(
        { categories: ['invite'], subject: 'Team offsite' },
        'Team offsite',
        'Harvard Square',
      ),
    ).toBe('social');
  });
});

describe('enrichEmailOne', () => {
  it('happy path: writes 1 episode + 1 candidate + 1 suggestion; enqueues node_regen', async () => {
    const now = new Date('2026-04-21T18:04:05Z');
    const { supabase, state } = makeSupabase({ emailRow: emailRow() });
    const result: EmailExtractionResult = {
      episodes: [
        {
          kind: 'reservation',
          occurred_at: '2026-04-25T23:00:00Z',
          title: "Dinner at Giulia's",
          summary: "OpenTable reservation at Giulia's for 4.",
          subject_reference: "place:Giulia's",
          attributes: { party_size: 4, reservation_id: '9A7B' },
        },
      ],
      facts: [
        {
          id: 'f_001',
          subject: "place:Giulia's",
          predicate: 'located_in',
          object_value: 'Cambridge MA',
          confidence: 0.9,
          evidence: '1372 Cambridge St.',
          valid_from: 'inferred',
        },
      ],
      suggestions: [
        {
          kind: 'add_to_calendar',
          title: "Dinner at Giulia's",
          starts_at: '2026-04-25T23:00:00Z',
          location: "Giulia's, Cambridge MA",
          attendees: [],
          rationale: 'OpenTable confirmed a reservation; mirror to calendar.',
          confidence: 0.85,
        },
      ],
    };
    const extractor: ModelEmailExtractor = { extract: vi.fn(async () => result) };
    const { queues, sent } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.episodeInserts).toHaveLength(1);
    expect(state.candidateInserts).toHaveLength(1);
    expect(state.candidateInserts[0]!.source).toBe('extraction');
    expect(state.suggestionInserts).toHaveLength(1);
    expect(state.suggestionInserts[0]!.kind).toBe('add_to_calendar');
    expect(state.suggestionInserts[0]!.segment).toBe('food');
    expect(state.suggestionInserts[0]!.status).toBe('pending');
    const preview = state.suggestionInserts[0]!.preview as {
      source_email_id: string;
      starts_at: string;
    };
    expect(preview.source_email_id).toBe(EMAIL_ID);
    expect(preview.starts_at).toBe('2026-04-25T23:00:00Z');
    // node_regen enqueued for the place node.
    expect(sent.some((s) => s.queue === 'node_regen')).toBe(true);
    // Audit row with the enrichment summary.
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]!.action).toBe('mem.email.enriched');
  });

  it('receipt path: writes episode + candidate, no suggestion', async () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const { supabase, state } = makeSupabase({
      emailRow: emailRow({
        subject: "Your receipt from Trader Joe's",
        from_email: 'noreply@traderjoes.com',
        from_name: "Trader Joe's",
        categories: ['receipt'],
        body_preview: "Thanks for shopping at Trader Joe's Cambridge!",
      }),
    });
    const result: EmailExtractionResult = {
      episodes: [
        {
          kind: 'receipt',
          occurred_at: '2026-04-20T22:40:00Z',
          title: "Trader Joe's receipt",
          summary: "Trader Joe's receipt for $87.14.",
          subject_reference: "merchant:Trader Joe's",
          attributes: { amount_cents: 8714, currency: 'USD', category: 'groceries' },
        },
      ],
      facts: [
        {
          id: 'f_001',
          subject: "merchant:Trader Joe's",
          predicate: 'sells_category',
          object_value: 'groceries',
          confidence: 0.85,
          evidence: "Thanks for shopping at Trader Joe's Cambridge!",
          valid_from: 'inferred',
        },
      ],
      suggestions: [],
    };
    const extractor: ModelEmailExtractor = { extract: vi.fn(async () => result) };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.episodeInserts).toHaveLength(1);
    expect(state.candidateInserts).toHaveLength(1);
    expect(state.suggestionInserts).toHaveLength(0);
  });

  it('empty extraction: audit only, no writes', async () => {
    const now = new Date('2026-04-21T18:04:05Z');
    const { supabase, state } = makeSupabase({
      emailRow: emailRow({ subject: 'Newsletter', categories: [] }),
    });
    const extractor: ModelEmailExtractor = {
      extract: vi.fn(async () => ({ episodes: [], facts: [], suggestions: [] })),
    };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.episodeInserts).toHaveLength(0);
    expect(state.candidateInserts).toHaveLength(0);
    expect(state.suggestionInserts).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]!.action).toBe('mem.email.enriched');
  });

  it('budget exceeded: skips extraction entirely, writes audit, returns', async () => {
    const now = new Date('2026-04-21T18:04:05Z');
    const { supabase, state } = makeSupabase({
      emailRow: emailRow(),
      householdSettings: { model_budget_monthly_cents: 100 },
      modelCallRows: [{ cost_usd: 1.5 }], // $1.50 = 150 cents > 100c
    });
    const extractor: ModelEmailExtractor = {
      extract: vi.fn(async () => ({ episodes: [], facts: [], suggestions: [] })),
    };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(extractor.extract).not.toHaveBeenCalled();
    expect(state.episodeInserts).toHaveLength(0);
    expect(state.candidateInserts).toHaveLength(0);
    expect(state.suggestionInserts).toHaveLength(0);
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]!.action).toBe('mem.email.skipped');
    expect((state.auditInserts[0]!.after as { reason: string }).reason).toBe('budget_exceeded');
  });

  it('throws when the email row is missing (DLQ path)', async () => {
    const { supabase } = makeSupabase({ emailRow: null });
    const { queues } = makeQueues();
    const extractor: ModelEmailExtractor = {
      extract: vi.fn(async () => ({ episodes: [], facts: [], suggestions: [] })),
    };

    await expect(
      enrichEmailOne(
        {
          supabase: supabase as never,
          queues,
          log: makeLog(),
          extractor,
        },
        envelope(),
      ),
    ).rejects.toThrow(/not found/);
  });

  it('throws when the extractor fails (DLQ path)', async () => {
    const { supabase } = makeSupabase({ emailRow: emailRow() });
    const { queues } = makeQueues();
    const extractor: ModelEmailExtractor = {
      extract: vi.fn(async () => {
        throw new Error('model down');
      }),
    };

    await expect(
      enrichEmailOne(
        {
          supabase: supabase as never,
          queues,
          log: makeLog(),
          extractor,
        },
        envelope(),
      ),
    ).rejects.toThrow(/email extractor failed/);
  });

  it('idempotent re-run: duplicate suggestion is deduped', async () => {
    const now = new Date('2026-04-21T18:04:05Z');
    const duplicatePreview = {
      starts_at: '2026-04-25T23:00:00Z',
      source_email_id: EMAIL_ID,
    };
    const { supabase, state } = makeSupabase({
      emailRow: emailRow(),
      existingSuggestions: [{ id: 'sug-pre', preview: duplicatePreview, kind: 'add_to_calendar' }],
    });
    const result: EmailExtractionResult = {
      episodes: [],
      facts: [],
      suggestions: [
        {
          kind: 'add_to_calendar',
          title: "Dinner at Giulia's",
          starts_at: '2026-04-25T23:00:00Z',
          location: "Giulia's",
          attendees: [],
          rationale: 'test',
          confidence: 0.85,
        },
      ],
    };
    const extractor: ModelEmailExtractor = { extract: vi.fn(async () => result) };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    // No new suggestion inserted — duplicate detected.
    expect(state.suggestionInserts).toHaveLength(0);
  });

  it('receipt → app.transaction (happy path): writes an email_receipt row', async () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const { supabase, state } = makeSupabase({
      emailRow: emailRow({
        subject: "Your receipt from Trader Joe's",
        from_email: 'noreply@traderjoes.com',
        from_name: "Trader Joe's",
        categories: ['receipt'],
        body_preview: 'total $87.14',
      }),
    });
    const result: EmailExtractionResult = {
      episodes: [
        {
          kind: 'receipt',
          occurred_at: '2026-04-20T22:40:00Z',
          title: "Trader Joe's receipt",
          summary: "Trader Joe's receipt for $87.14.",
          subject_reference: "merchant:Trader Joe's",
          attributes: {
            merchant: "Trader Joe's",
            amount_cents: 8714,
            currency: 'USD',
            category: 'groceries',
          },
        },
      ],
      facts: [],
      suggestions: [],
    };
    const extractor: ModelEmailExtractor = { extract: vi.fn(async () => result) };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.transactionInserts).toHaveLength(1);
    const tx = state.transactionInserts[0]!;
    expect(tx.source).toBe('email_receipt');
    expect(tx.source_id).toBe(EMAIL_ID);
    expect(tx.household_id).toBe(HOUSEHOLD_ID);
    expect(tx.amount_cents).toBe(-8714);
    expect(tx.currency).toBe('USD');
    expect(tx.merchant_raw).toBe("Trader Joe's");
    expect(tx.category).toBe('groceries');
    expect(tx.account_id).toBeNull();
    const meta = tx.metadata as Record<string, unknown>;
    expect(meta.status).toBe('unmatched');
    expect(meta.source_email_id).toBe(EMAIL_ID);
    expect(meta.extracted_from).toBe('email_receipt_extraction');
  });

  it('receipt → app.transaction: skips when one already exists (idempotent)', async () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const { supabase, state } = makeSupabase({
      emailRow: emailRow({ categories: ['receipt'] }),
      existingTransactions: [
        {
          id: 'tx-existing',
          household_id: HOUSEHOLD_ID,
          source: 'email_receipt',
          source_id: EMAIL_ID,
        },
      ],
    });
    const result: EmailExtractionResult = {
      episodes: [
        {
          kind: 'receipt',
          occurred_at: '2026-04-20T22:40:00Z',
          title: "Trader Joe's receipt",
          summary: "Trader Joe's receipt",
          subject_reference: "merchant:Trader Joe's",
          attributes: { merchant: "Trader Joe's", amount_cents: 8714, currency: 'USD' },
        },
      ],
      facts: [],
      suggestions: [],
    };
    const extractor: ModelEmailExtractor = { extract: vi.fn(async () => result) };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.transactionInserts).toHaveLength(0);
  });

  it('receipt → app.transaction: skips when amount_cents is missing', async () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const { supabase, state } = makeSupabase({
      emailRow: emailRow({ categories: ['receipt'] }),
    });
    const result: EmailExtractionResult = {
      episodes: [
        {
          kind: 'receipt',
          occurred_at: '2026-04-20T22:40:00Z',
          title: "Trader Joe's receipt",
          summary: "Trader Joe's receipt",
          subject_reference: "merchant:Trader Joe's",
          attributes: { merchant: "Trader Joe's" },
        },
      ],
      facts: [],
      suggestions: [],
    };
    const extractor: ModelEmailExtractor = { extract: vi.fn(async () => result) };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.transactionInserts).toHaveLength(0);
  });

  it('receipt → app.transaction: positive sign when attributes.refund is true', async () => {
    const now = new Date('2026-04-21T00:00:00Z');
    const { supabase, state } = makeSupabase({
      emailRow: emailRow({ categories: ['receipt'] }),
    });
    const result: EmailExtractionResult = {
      episodes: [
        {
          kind: 'receipt',
          occurred_at: '2026-04-20T22:40:00Z',
          title: 'Amazon refund',
          summary: 'Amazon refund',
          subject_reference: 'merchant:Amazon',
          attributes: { merchant: 'Amazon', amount_cents: 1999, currency: 'USD', refund: true },
        },
      ],
      facts: [],
      suggestions: [],
    };
    const extractor: ModelEmailExtractor = { extract: vi.fn(async () => result) };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.transactionInserts).toHaveLength(1);
    expect(state.transactionInserts[0]!.amount_cents).toBe(1999);
  });

  it('skips suggestions whose starts_at precedes received_at', async () => {
    const now = new Date('2026-04-21T18:04:05Z');
    const { supabase, state } = makeSupabase({ emailRow: emailRow() });
    const past: EmailExtractionResult = {
      episodes: [],
      facts: [],
      suggestions: [
        {
          kind: 'add_to_calendar',
          title: 'Past reservation?',
          // Before the email received_at — model shouldn't have emitted this.
          starts_at: '2020-01-01T00:00:00Z',
          attendees: [],
          rationale: 'test',
          confidence: 0.85,
        },
      ],
    };
    const extractor: ModelEmailExtractor = { extract: vi.fn(async () => past) };
    const { queues } = makeQueues();

    await enrichEmailOne(
      {
        supabase: supabase as never,
        queues,
        log: makeLog(),
        extractor,
        now: () => now,
      },
      envelope(),
    );

    expect(state.suggestionInserts).toHaveLength(0);
  });
});
