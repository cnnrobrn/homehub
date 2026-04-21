/**
 * In-memory Supabase-client fake for unit tests.
 *
 * Supports the narrow slice of the PostgREST surface the household flows
 * use: `.schema(name).from(table)` with `.select/.insert/.update/.delete/
 * .upsert`, plus chainable filter methods (`.eq`, `.in`, `.is`, `.not`,
 * `.order`, `.limit`, `.maybeSingle`, `.single`).
 *
 * This is deliberately not a full PostgREST simulator — it implements
 * *only* the filter combinations used by the flows under test. New flows
 * will extend it as needed.
 */

import { type SupabaseClient } from '@supabase/supabase-js';

export interface TableState<Row extends Record<string, unknown>> {
  rows: Row[];
}

export type SchemaState = Record<string, TableState<Record<string, unknown>>>;

export interface FakeStore {
  app: SchemaState;
  audit: SchemaState;
  sync: SchemaState;
}

export function createStore(): FakeStore {
  return {
    app: {
      household: { rows: [] },
      member: { rows: [] },
      member_segment_grant: { rows: [] },
      household_invitation: { rows: [] },
      model_calls: { rows: [] },
      suggestion: { rows: [] },
      action: { rows: [] },
    },
    audit: {
      event: { rows: [] },
    },
    sync: {
      dead_letter: { rows: [] },
      provider_connection: { rows: [] },
      cursor: { rows: [] },
    },
  };
}

type Filter = {
  kind: 'eq' | 'neq' | 'in' | 'is' | 'notIs' | 'not';
  col: string;
  val: unknown;
};

type OrderOpt = { col: string; ascending: boolean; nullsFirst: boolean };

function applyFilters<R extends Record<string, unknown>>(rows: R[], filters: Filter[]): R[] {
  return rows.filter((row) => {
    for (const f of filters) {
      const v = row[f.col];
      switch (f.kind) {
        case 'eq':
          if (v !== f.val) return false;
          break;
        case 'neq':
          if (v === f.val) return false;
          break;
        case 'in':
          if (!Array.isArray(f.val) || !f.val.includes(v)) return false;
          break;
        case 'is':
          if (f.val === null ? v !== null : v !== f.val) return false;
          break;
        case 'notIs':
          if (f.val === null ? v === null : v === f.val) return false;
          break;
        case 'not':
          if (v === f.val) return false;
          break;
      }
    }
    return true;
  });
}

function matchOnConflict<R extends Record<string, unknown>>(
  existing: R[],
  candidate: R,
  keyCols: string[],
): R | null {
  return existing.find((row) => keyCols.every((k) => row[k] === candidate[k])) ?? null;
}

function applyNestedSelect(
  row: Record<string, unknown>,
  store: FakeStore,
): Record<string, unknown> {
  // Flow helpers request a household via `household:household_id(...)`.
  // Simulate that by resolving `household_id` -> full household row when
  // the caller wants it. Expand lazily — the flow code normalizes to
  // either an object or [object].
  const out = { ...row };
  if ('household_id' in out && !('household' in out)) {
    const household = store.app.household?.rows.find((r) => r.id === out.household_id) ?? null;
    out.household = household;
  }
  return out;
}

export class FakeQuery {
  private filters: Filter[] = [];
  private orderOpt: OrderOpt | null = null;
  private limitN: number | null = null;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private writeData: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private upsertOnConflict: string[] = [];

  constructor(
    private readonly store: FakeStore,
    private readonly schemaName: 'app' | 'audit' | 'sync',
    private readonly tableName: string,
  ) {}

  private rows(): Record<string, unknown>[] {
    return this.store[this.schemaName][this.tableName]?.rows ?? [];
  }

  select(_columns?: string): this {
    this.mode =
      this.mode === 'insert' || this.mode === 'update' || this.mode === 'upsert'
        ? this.mode
        : 'select';
    void _columns;
    return this;
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.mode = 'insert';
    this.writeData = data;
    return this;
  }

  update(data: Record<string, unknown>): this {
    this.mode = 'update';
    this.writeData = data;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  upsert(
    data: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string },
  ): this {
    this.mode = 'upsert';
    this.writeData = data;
    this.upsertOnConflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : [];
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ kind: 'eq', col, val });
    return this;
  }

  neq(col: string, val: unknown): this {
    this.filters.push({ kind: 'neq', col, val });
    return this;
  }

  in(col: string, val: unknown[]): this {
    this.filters.push({ kind: 'in', col, val });
    return this;
  }

  is(col: string, val: unknown): this {
    this.filters.push({ kind: 'is', col, val });
    return this;
  }

  not(col: string, op: 'is', val: unknown): this {
    if (op === 'is') {
      this.filters.push({ kind: 'notIs', col, val });
    }
    return this;
  }

  order(col: string, opts: { ascending: boolean; nullsFirst?: boolean }): this {
    this.orderOpt = { col, ascending: opts.ascending, nullsFirst: opts.nullsFirst ?? false };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    return this.execute().then((r) => ({
      data: (r.data as Record<string, unknown>[])[0] ?? null,
      error: null,
    }));
  }

  single(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
    return this.execute().then((r) => {
      const arr = r.data as Record<string, unknown>[];
      if (arr.length === 0) {
        return { data: null, error: { message: 'no rows returned' } };
      }
      return { data: arr[0] ?? null, error: null };
    });
  }

  then<T>(
    onfulfilled?: (v: { data: unknown; error: unknown }) => T | PromiseLike<T>,
    onrejected?: (reason: unknown) => T | PromiseLike<T>,
  ): PromiseLike<T> {
    return this.execute().then(onfulfilled, onrejected) as unknown as PromiseLike<T>;
  }

  catch<T>(
    onrejected?: (reason: unknown) => T | PromiseLike<T>,
  ): PromiseLike<T | { data: unknown; error: unknown }> {
    return this.execute().catch(onrejected) as PromiseLike<T | { data: unknown; error: unknown }>;
  }

  private async execute(): Promise<{ data: unknown; error: null }> {
    const table = this.store[this.schemaName][this.tableName];
    if (!table) throw new Error(`FakeQuery: unknown table ${this.schemaName}.${this.tableName}`);

    switch (this.mode) {
      case 'insert': {
        const arr = Array.isArray(this.writeData) ? this.writeData : [this.writeData];
        const inserted: Record<string, unknown>[] = [];
        for (const raw of arr) {
          const row: Record<string, unknown> = {
            id: (raw as Record<string, unknown>).id ?? cryptoRandomUUID(),
            ...(raw as Record<string, unknown>),
          };
          // Apply defaults the schema provides (timestamps).
          if (row.created_at === undefined && this.tableName !== 'member_segment_grant') {
            row.created_at = new Date().toISOString();
          }
          if (this.tableName === 'member' && row.invited_at === undefined) {
            row.invited_at = new Date().toISOString();
          }
          // Materialize known-nullable columns with an explicit `null`
          // so `.is(col, null)` filters find them. PostgREST returns
          // every column on select; tests need the same behavior.
          const nullableCols: Record<string, string[]> = {
            household_invitation: ['accepted_at', 'accepted_by'],
            member: ['user_id', 'email', 'joined_at'],
            person: ['member_id'],
          };
          for (const col of nullableCols[this.tableName] ?? []) {
            if (!(col in row)) row[col] = null;
          }
          table.rows.push(row);
          inserted.push(row);
        }
        const out = inserted.map((r) => applyNestedSelect(r, this.store));
        return { data: out, error: null };
      }
      case 'update': {
        const matching = applyFilters(table.rows, this.filters);
        const patch = this.writeData as Record<string, unknown>;
        for (const r of matching) Object.assign(r, patch);
        const out = matching.map((r) => applyNestedSelect(r, this.store));
        return { data: out, error: null };
      }
      case 'upsert': {
        const arr = Array.isArray(this.writeData) ? this.writeData : [this.writeData];
        const affected: Record<string, unknown>[] = [];
        for (const raw of arr) {
          const candidate = raw as Record<string, unknown>;
          const existing = this.upsertOnConflict.length
            ? matchOnConflict(table.rows, candidate, this.upsertOnConflict)
            : null;
          if (existing) {
            Object.assign(existing, candidate);
            affected.push(existing);
          } else {
            const row = { id: candidate.id ?? cryptoRandomUUID(), ...candidate };
            table.rows.push(row);
            affected.push(row);
          }
        }
        return { data: affected, error: null };
      }
      case 'delete': {
        const matching = applyFilters(table.rows, this.filters);
        const keep = new Set(table.rows.filter((r) => !matching.includes(r)));
        table.rows.length = 0;
        table.rows.push(...keep);
        return { data: matching, error: null };
      }
      case 'select':
      default: {
        let rows = applyFilters(table.rows, this.filters).map((r) =>
          applyNestedSelect(r, this.store),
        );
        if (this.orderOpt) {
          const { col, ascending, nullsFirst } = this.orderOpt;
          rows = [...rows].sort((a, b) => {
            const av = a[col];
            const bv = b[col];
            if (av == null && bv == null) return 0;
            if (av == null) return nullsFirst ? -1 : 1;
            if (bv == null) return nullsFirst ? 1 : -1;
            if (av < bv) return ascending ? -1 : 1;
            if (av > bv) return ascending ? 1 : -1;
            return 0;
          });
        }
        if (this.limitN != null) rows = rows.slice(0, this.limitN);
        return { data: rows, error: null };
      }
    }
  }
}

function cryptoRandomUUID(): string {
  return globalThis.crypto?.randomUUID() ?? `uuid-${Math.random().toString(36).slice(2)}`;
}

export function createFakeSupabase(store: FakeStore): SupabaseClient {
  const schema = (name: 'app' | 'audit' | 'sync') => ({
    from(tableName: string) {
      return new FakeQuery(store, name, tableName);
    },
  });
  return {
    schema(name: string) {
      if (name !== 'app' && name !== 'audit' && name !== 'sync') {
        throw new Error(`FakeSupabase: unknown schema ${name}`);
      }
      return schema(name);
    },
  } as unknown as SupabaseClient;
}
