/**
 * Unit tests for the reconciler.
 *
 * We stub Supabase. The fake stores candidates, canonical facts, and
 * nodes in in-memory maps and routes the chained query-builder calls
 * the reconciler issues.
 */

import { type Logger } from '@homehub/worker-runtime';
import { beforeEach, describe, expect, it } from 'vitest';

import { reconcileCandidate } from './reconcile.js';

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

/**
 * In-memory Supabase fake shaped to answer exactly the query patterns
 * the reconciler issues against `mem.*`. Each test seeds the fake
 * with candidate rows, canonical facts, and nodes, then inspects the
 * fake after `reconcileCandidate` runs.
 */
interface FactRow {
  id: string;
  household_id: string;
  subject_node_id: string;
  predicate: string;
  object_value: unknown;
  object_node_id: string | null;
  confidence: number;
  evidence: unknown[];
  valid_from: string;
  valid_to: string | null;
  recorded_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
  source: string;
  reinforcement_count: number;
  last_reinforced_at: string;
  conflict_status: string;
}

interface CandidateRow {
  id: string;
  household_id: string;
  subject_node_id: string | null;
  predicate: string;
  object_value: unknown;
  object_node_id: string | null;
  confidence: number | null;
  evidence: unknown[];
  valid_from: string | null;
  valid_to: string | null;
  recorded_at: string;
  source: string;
  status: string;
  promoted_fact_id: string | null;
  reason: string | null;
}

interface NodeRow {
  id: string;
  household_id: string;
  needs_review: boolean;
  type: string;
  canonical_name: string;
}

function makeFakeSupabase() {
  const state = {
    candidates: new Map<string, CandidateRow>(),
    facts: new Map<string, FactRow>(),
    nodes: new Map<string, NodeRow>(),
    factInserts: [] as FactRow[],
    factUpdates: [] as Array<{ id: string; patch: Partial<FactRow> }>,
    candidateUpdates: [] as Array<{ id: string; patch: Partial<CandidateRow> }>,
    nodeUpdates: [] as Array<{ id: string; patch: Partial<NodeRow> }>,
  };

  let nextFactId = 1;

  function memFrom(table: string) {
    if (table === 'fact_candidate') return factCandidateChain();
    if (table === 'fact') return factChain();
    if (table === 'node') return nodeChain();
    throw new Error(`unexpected mem.${table}`);
  }

  function factCandidateChain() {
    const filters: Record<string, unknown> = {};
    let mode: 'select' | 'update' | 'insert' = 'select';
    let patch: Record<string, unknown> = {};
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
      async maybeSingle() {
        const id = filters.id as string | undefined;
        if (id && state.candidates.has(id)) {
          return { data: state.candidates.get(id), error: null };
        }
        return { data: null, error: null };
      },
      update(p: Record<string, unknown>) {
        mode = 'update';
        patch = p;
        return chain;
      },
    };
    // The reconciler updates via `.update(patch).eq('id', id)`. The
    // `.eq` variant on the update path must resolve to a promise.
    const origEq = chain.eq as (col: string, val: unknown) => unknown;
    chain.eq = (col: string, val: unknown) => {
      filters[col] = val;
      if (mode === 'update') {
        // Resolve the update.
        const id = filters.id as string;
        const current = state.candidates.get(id);
        if (!current) {
          return Promise.resolve({ data: null, error: { message: 'no such candidate' } });
        }
        const updated = { ...current, ...patch } as CandidateRow;
        state.candidates.set(id, updated);
        state.candidateUpdates.push({ id, patch: patch as Partial<CandidateRow> });
        return Promise.resolve({ data: null, error: null });
      }
      return origEq(col, val);
    };
    return chain;
  }

  function factChain() {
    const filters: Record<string, unknown> = {};
    let mode: 'select' | 'update' | 'insert' | 'delete' = 'select';
    let patch: Record<string, unknown> = {};
    let limit: number | undefined;
    let insertPayload: Record<string, unknown> | undefined;

    const chain: Record<string, unknown> = {
      select() {
        mode = 'select';
        return chain;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        if (mode === 'update') {
          const id = filters.id as string;
          const current = state.facts.get(id);
          if (!current) {
            return Promise.resolve({ data: null, error: { message: 'no such fact' } });
          }
          const updated = { ...current, ...patch } as FactRow;
          state.facts.set(id, updated);
          state.factUpdates.push({ id, patch: patch as Partial<FactRow> });
          return Promise.resolve({ data: null, error: null });
        }
        if (mode === 'delete') {
          state.facts.delete(filters.id as string);
          return Promise.resolve({ data: null, error: null });
        }
        return chain;
      },
      is(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
      limit(n: number) {
        limit = n;
        return chain;
      },
      single(this: void) {
        if (!insertPayload) throw new Error('single() without insert');
        const id = `fact-${nextFactId++}`;
        const row: FactRow = {
          id,
          household_id: insertPayload.household_id as string,
          subject_node_id: insertPayload.subject_node_id as string,
          predicate: insertPayload.predicate as string,
          object_value: insertPayload.object_value ?? null,
          object_node_id: (insertPayload.object_node_id as string | null) ?? null,
          confidence: insertPayload.confidence as number,
          evidence: (insertPayload.evidence as unknown[]) ?? [],
          valid_from: insertPayload.valid_from as string,
          valid_to: null,
          recorded_at: (insertPayload.recorded_at as string) ?? new Date().toISOString(),
          superseded_at: null,
          superseded_by: null,
          source: insertPayload.source as string,
          reinforcement_count: (insertPayload.reinforcement_count as number) ?? 1,
          last_reinforced_at:
            (insertPayload.last_reinforced_at as string) ?? new Date().toISOString(),
          conflict_status: (insertPayload.conflict_status as string) ?? 'none',
        };
        state.facts.set(id, row);
        state.factInserts.push(row);
        return Promise.resolve({ data: { id }, error: null });
      },
      insert(p: Record<string, unknown>) {
        mode = 'insert';
        insertPayload = p;
        return chain;
      },
      update(p: Record<string, unknown>) {
        mode = 'update';
        patch = p;
        return chain;
      },
      delete() {
        mode = 'delete';
        return chain;
      },
    };

    // A generic "resolve to rows" path for chained select queries.
    (chain as Record<string, unknown>).then = (
      fulfill: (v: { data: FactRow[] | null; error: null | { message: string } }) => unknown,
    ) => {
      // Filter matching rows.
      const rows = Array.from(state.facts.values()).filter((r) => {
        for (const [k, v] of Object.entries(filters)) {
          // `null` filter (for IS NULL)
          if (v === null) {
            if ((r as unknown as Record<string, unknown>)[k] !== null) return false;
          } else if ((r as unknown as Record<string, unknown>)[k] !== v) {
            return false;
          }
        }
        return true;
      });
      const result = {
        data: limit != null ? rows.slice(0, limit) : rows,
        error: null,
      };
      return Promise.resolve(fulfill(result));
    };

    return chain;
  }

  function nodeChain() {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      update(p: Record<string, unknown>) {
        patch = p;
        return chain;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        const id = filters.id as string;
        const current = state.nodes.get(id);
        if (!current) {
          return Promise.resolve({ data: null, error: { message: 'no such node' } });
        }
        const updated = { ...current, ...patch } as NodeRow;
        state.nodes.set(id, updated);
        state.nodeUpdates.push({ id, patch: patch as Partial<NodeRow> });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  const supabase = {
    schema(name: string) {
      if (name !== 'mem') throw new Error(`unexpected schema ${name}`);
      return {
        from(table: string) {
          return memFrom(table);
        },
      };
    },
  };
  return { supabase, state };
}

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const SUBJECT_NODE_ID = 'n0000000-0000-4000-8000-000000000001';

function seedCandidate(
  state: ReturnType<typeof makeFakeSupabase>['state'],
  id: string,
  patch: Partial<CandidateRow> = {},
): void {
  state.candidates.set(id, {
    id,
    household_id: HOUSEHOLD_ID,
    subject_node_id: SUBJECT_NODE_ID,
    predicate: 'is',
    object_value: 'vegetarian',
    object_node_id: null,
    confidence: 0.85,
    evidence: [{ source: 'extraction' }],
    valid_from: '2026-04-20T00:00:00Z',
    valid_to: null,
    recorded_at: '2026-04-20T01:00:00Z',
    source: 'extraction',
    status: 'pending',
    promoted_fact_id: null,
    reason: null,
    ...patch,
  });
}

function seedNode(
  state: ReturnType<typeof makeFakeSupabase>['state'],
  id: string = SUBJECT_NODE_ID,
): void {
  state.nodes.set(id, {
    id,
    household_id: HOUSEHOLD_ID,
    needs_review: false,
    type: 'person',
    canonical_name: 'Sarah',
  });
}

function seedFact(
  state: ReturnType<typeof makeFakeSupabase>['state'],
  id: string,
  patch: Partial<FactRow> = {},
): void {
  state.facts.set(id, {
    id,
    household_id: HOUSEHOLD_ID,
    subject_node_id: SUBJECT_NODE_ID,
    predicate: 'is',
    object_value: 'vegetarian',
    object_node_id: null,
    confidence: 0.8,
    evidence: [],
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: null,
    recorded_at: '2026-01-01T00:00:00Z',
    superseded_at: null,
    superseded_by: null,
    source: 'extraction',
    reinforcement_count: 1,
    last_reinforced_at: '2026-01-01T00:00:00Z',
    conflict_status: 'none',
    ...patch,
  });
}

describe('reconcileCandidate', () => {
  let now: Date;
  beforeEach(() => {
    now = new Date('2026-04-20T12:00:00Z');
  });

  it('promotes a new high-confidence fact', async () => {
    const { supabase, state } = makeFakeSupabase();
    seedNode(state);
    seedCandidate(state, 'c1');

    const result = await reconcileCandidate(
      { supabase: supabase as never, log: makeLog(), now: () => now },
      'c1',
    );

    expect(result.outcome).toBe('promoted');
    expect(result.factId).toBeTruthy();
    expect(state.factInserts).toHaveLength(1);
    expect(state.factInserts[0]?.predicate).toBe('is');
    expect(state.candidates.get('c1')?.status).toBe('promoted');
  });

  it('keeps below-threshold candidates pending when no canonical exists', async () => {
    const { supabase, state } = makeFakeSupabase();
    seedNode(state);
    seedCandidate(state, 'c1', { confidence: 0.4 });

    const result = await reconcileCandidate(
      { supabase: supabase as never, log: makeLog(), now: () => now },
      'c1',
    );

    expect(result.outcome).toBe('parked');
    expect(state.factInserts).toHaveLength(0);
    // Candidate stays pending.
    expect(state.candidates.get('c1')?.status).toBe('pending');
  });

  it('reinforces an existing canonical with the same object', async () => {
    const { supabase, state } = makeFakeSupabase();
    seedNode(state);
    seedFact(state, 'f1', { confidence: 0.8, reinforcement_count: 1 });
    seedCandidate(state, 'c1');

    const result = await reconcileCandidate(
      { supabase: supabase as never, log: makeLog(), now: () => now },
      'c1',
    );

    expect(result.outcome).toBe('reinforced');
    expect(result.factId).toBe('f1');
    const f = state.facts.get('f1');
    expect(f?.reinforcement_count).toBe(2);
    expect(f?.confidence).toBeGreaterThan(0.8);
    expect(state.candidates.get('c1')?.status).toBe('promoted');
  });

  it('supersedes a canonical fact when candidate wins the conflict', async () => {
    const { supabase, state } = makeFakeSupabase();
    seedNode(state);
    seedFact(state, 'f1', {
      object_value: 'vegetarian',
      confidence: 0.6,
      source: 'extraction',
    });
    seedCandidate(state, 'c1', {
      object_value: 'vegan',
      confidence: 0.95,
      source: 'extraction',
    });

    const result = await reconcileCandidate(
      { supabase: supabase as never, log: makeLog(), now: () => now },
      'c1',
    );

    expect(result.outcome).toBe('conflict');
    expect(result.reason).toMatch(/won/);
    expect(state.factInserts).toHaveLength(1);
    // Old canonical closed.
    const old = state.facts.get('f1');
    expect(old?.valid_to).toBe(now.toISOString());
    expect(old?.superseded_at).toBe(now.toISOString());
    expect(old?.superseded_by).toBe(result.factId);
    expect(state.candidates.get('c1')?.status).toBe('promoted');
  });

  it('parks the conflict for destructive predicates', async () => {
    const { supabase, state } = makeFakeSupabase();
    seedNode(state);
    seedFact(state, 'f1', {
      predicate: 'avoids',
      object_value: 'peanuts',
      source: 'member',
      confidence: 0.95,
    });
    seedCandidate(state, 'c1', {
      predicate: 'avoids',
      object_value: 'tree nuts',
      confidence: 0.92,
      source: 'extraction',
    });

    const result = await reconcileCandidate(
      { supabase: supabase as never, log: makeLog(), now: () => now },
      'c1',
    );

    expect(result.outcome).toBe('conflict');
    expect(result.reason).toMatch(/parked/);
    const canonical = state.facts.get('f1');
    expect(canonical?.conflict_status).toBe('parked_conflict');
    expect(state.candidates.get('c1')?.status).toBe('parked');
    // Subject node flagged for member review.
    expect(state.nodes.get(SUBJECT_NODE_ID)?.needs_review).toBe(true);
  });

  it('protects member-written canonical from model-inferred candidate', async () => {
    const { supabase, state } = makeFakeSupabase();
    seedNode(state);
    seedFact(state, 'f1', {
      object_value: 'vegan',
      source: 'member',
      confidence: 0.95,
    });
    seedCandidate(state, 'c1', {
      object_value: 'vegetarian',
      confidence: 0.85,
      source: 'extraction',
    });

    const result = await reconcileCandidate(
      { supabase: supabase as never, log: makeLog(), now: () => now },
      'c1',
    );

    expect(result.outcome).toBe('conflict');
    expect(result.reason).toMatch(/parked/);
    // Member canonical not superseded.
    const old = state.facts.get('f1');
    expect(old?.superseded_at).toBeNull();
    expect(old?.conflict_status).toBe('parked_conflict');
  });

  it('rejects candidates with missing subject_node_id', async () => {
    const { supabase, state } = makeFakeSupabase();
    seedCandidate(state, 'c1', { subject_node_id: null });

    const result = await reconcileCandidate(
      { supabase: supabase as never, log: makeLog(), now: () => now },
      'c1',
    );

    expect(result.outcome).toBe('rejected');
    expect(state.candidates.get('c1')?.status).toBe('rejected');
  });

  it('flags destructive-predicate promotions as needs_review', async () => {
    const { supabase, state } = makeFakeSupabase();
    seedNode(state);
    seedCandidate(state, 'c1', {
      predicate: 'avoids',
      object_value: 'peanuts',
      confidence: 0.95,
    });

    const result = await reconcileCandidate(
      { supabase: supabase as never, log: makeLog(), now: () => now },
      'c1',
    );

    expect(result.outcome).toBe('promoted');
    expect(state.nodes.get(SUBJECT_NODE_ID)?.needs_review).toBe(true);
  });
});
