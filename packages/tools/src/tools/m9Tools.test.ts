/**
 * Tests for the six M9-C draft-write tools that persist real
 * `app.suggestion` rows: propose_transfer, propose_cancel_subscription,
 * draft_message, propose_add_to_calendar, propose_book_reservation,
 * settle_shared_expense.
 *
 * Uses the same minimal Supabase double pattern as `tools.test.ts`.
 * Each tool is exercised:
 *   - happy path: returns `pending_approval` + inserts the row.
 *   - segment-access: unauthorized grants are rejected by the catalog
 *     gate (so we test via `createToolCatalog` + `.call()`).
 *   - validation: bad input fails through the catalog validator.
 */

import { describe, expect, it, vi } from 'vitest';

import { createToolCatalogFromDefinitions } from '../catalog.js';

import { draftMessageTool } from './draftMessage.js';
import { proposeAddToCalendarTool } from './proposeAddToCalendar.js';
import { proposeBookReservationTool } from './proposeBookReservation.js';
import { proposeCancelSubscriptionTool } from './proposeCancelSubscription.js';
import { proposeTransferTool } from './proposeTransfer.js';
import { settleSharedExpenseTool } from './settleSharedExpense.js';

import type { ToolContext, ToolDefinition } from '../types.js';

// ---------------------------------------------------------------------------
// Minimal supabase stub: every `insert(...).select('id').single()` call
// resolves to `{ data: { id: 'sug-<n>' } }`.
// ---------------------------------------------------------------------------

interface InsertRecord {
  schema: string;
  table: string;
  row: Record<string, unknown>;
}

function makeSupabase(inserts: InsertRecord[]) {
  return {
    schema(name: string) {
      return {
        from(table: string) {
          let pending: Record<string, unknown> | null = null;
          const thenable: Record<string, unknown> = {
            insert(row: Record<string, unknown>) {
              pending = row;
              return thenable;
            },
            select() {
              return thenable;
            },
            single: vi.fn(async () => {
              if (!pending) return { data: null, error: null };
              const idx = inserts.length;
              inserts.push({ schema: name, table, row: pending });
              return { data: { id: `sug-${idx + 1}` }, error: null };
            }),
          };
          return thenable;
        },
      };
    },
  };
}

function mkCtx(
  sb: ReturnType<typeof makeSupabase>,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return {
    householdId: 'hh-1' as ToolContext['householdId'],
    memberId: 'm-1' as ToolContext['memberId'],
    memberRole: 'adult',
    grants: [
      { segment: 'financial', access: 'write' },
      { segment: 'food', access: 'write' },
      { segment: 'fun', access: 'write' },
      { segment: 'social', access: 'write' },
    ],
    supabase: sb as unknown as ToolContext['supabase'],
    queryMemory: { query: vi.fn() } as unknown as ToolContext['queryMemory'],
    log: logger as unknown as ToolContext['log'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Direct-handler tests — exercise the insert shape + pending_approval.
// ---------------------------------------------------------------------------

describe('propose_transfer tool', () => {
  it('inserts a pending financial suggestion', async () => {
    const inserts: InsertRecord[] = [];
    const sb = makeSupabase(inserts);
    const ctx = mkCtx(sb);
    const res = await proposeTransferTool.handler(
      {
        from_account_id: '00000000-0000-0000-0000-000000000001',
        to_account_id: '00000000-0000-0000-0000-000000000002',
        amount_cents: 20_000,
        currency: 'USD',
        reason: 'savings top-up',
      },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    expect(res.preview.amount_cents).toBe(20_000);
    const insert = inserts.find((i) => i.table === 'suggestion');
    expect(insert?.row['kind']).toBe('propose_transfer');
    expect(insert?.row['segment']).toBe('financial');
    expect(insert?.row['status']).toBe('pending');
  });

  it('rejects transfers where from==to', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb);
    await expect(
      proposeTransferTool.handler(
        {
          from_account_id: '00000000-0000-0000-0000-000000000001',
          to_account_id: '00000000-0000-0000-0000-000000000001',
          amount_cents: 100,
          currency: 'USD',
          reason: 'nope',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_accounts' });
  });

  it('catalog gate rejects callers without financial:write', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb, { grants: [{ segment: 'financial', access: 'read' }] });
    const catalog = createToolCatalogFromDefinitions(ctx, [
      proposeTransferTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('propose_transfer', {
      from_account_id: '00000000-0000-0000-0000-000000000001',
      to_account_id: '00000000-0000-0000-0000-000000000002',
      amount_cents: 100,
      currency: 'USD',
      reason: 'x',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('tool_forbidden');
  });

  it('catalog validator rejects bad input', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb);
    const catalog = createToolCatalogFromDefinitions(ctx, [
      proposeTransferTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('propose_transfer', { from_account_id: 'nope' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('tool_validation');
  });
});

describe('propose_cancel_subscription tool', () => {
  it('inserts a pending cancel_subscription suggestion', async () => {
    const inserts: InsertRecord[] = [];
    const sb = makeSupabase(inserts);
    const ctx = mkCtx(sb);
    const res = await proposeCancelSubscriptionTool.handler(
      {
        subscription_node_id: '00000000-0000-0000-0000-000000000042',
        merchant_name: 'Netflix',
        monthly_cost_cents: 1599,
      },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    expect(res.preview.merchant_name).toBe('Netflix');
    const insert = inserts.find((i) => i.table === 'suggestion');
    expect(insert?.row['kind']).toBe('cancel_subscription');
    expect(insert?.row['segment']).toBe('financial');
  });

  it('catalog gate rejects callers without financial:write', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb, { grants: [{ segment: 'financial', access: 'read' }] });
    const catalog = createToolCatalogFromDefinitions(ctx, [
      proposeCancelSubscriptionTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('propose_cancel_subscription', {
      subscription_node_id: '00000000-0000-0000-0000-000000000042',
      merchant_name: 'Netflix',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects bad input (missing merchant)', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb);
    const catalog = createToolCatalogFromDefinitions(ctx, [
      proposeCancelSubscriptionTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('propose_cancel_subscription', {
      subscription_node_id: '00000000-0000-0000-0000-000000000042',
    });
    expect(res.ok).toBe(false);
  });
});

describe('draft_message tool', () => {
  it('inserts a pending draft_message suggestion in the social segment', async () => {
    const inserts: InsertRecord[] = [];
    const sb = makeSupabase(inserts);
    const ctx = mkCtx(sb);
    const res = await draftMessageTool.handler(
      { to: 'sarah@example.com', subject: 'Dinner?', body_markdown: 'Want to get dinner Friday?' },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    const insert = inserts.find((i) => i.table === 'suggestion');
    expect(insert?.row['segment']).toBe('social');
    expect(insert?.row['kind']).toBe('draft_message');
  });

  it('catalog gate rejects callers without social:write', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb, { grants: [{ segment: 'social', access: 'read' }] });
    const catalog = createToolCatalogFromDefinitions(ctx, [
      draftMessageTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('draft_message', {
      to: 'sarah@example.com',
      body_markdown: 'hi',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects bad input (missing body)', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb);
    const catalog = createToolCatalogFromDefinitions(ctx, [
      draftMessageTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('draft_message', { to: 'sarah@example.com' });
    expect(res.ok).toBe(false);
  });
});

describe('propose_add_to_calendar tool', () => {
  it('infers segment from title and inserts a suggestion', async () => {
    const inserts: InsertRecord[] = [];
    const sb = makeSupabase(inserts);
    const ctx = mkCtx(sb);
    const res = await proposeAddToCalendarTool.handler(
      {
        title: 'Dinner with Sarah',
        starts_at: '2026-04-20T19:00:00Z',
        mirror_to_gcal: false,
      },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    expect(res.preview.segment).toBe('food');
  });

  it('defaults to social when title is ambiguous', async () => {
    const inserts: InsertRecord[] = [];
    const sb = makeSupabase(inserts);
    const ctx = mkCtx(sb);
    const res = await proposeAddToCalendarTool.handler(
      {
        title: 'Meeting',
        starts_at: '2026-04-20T19:00:00Z',
        mirror_to_gcal: false,
      },
      ctx,
    );
    expect(res.preview.segment).toBe('social');
  });

  it('rejects when caller lacks write on the inferred segment', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb, { grants: [{ segment: 'food', access: 'read' }] });
    await expect(
      proposeAddToCalendarTool.handler(
        { title: 'Dinner', starts_at: '2026-04-20T19:00:00Z', mirror_to_gcal: false },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'tool_forbidden' });
  });

  it('rejects bad ISO datetimes', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb);
    const catalog = createToolCatalogFromDefinitions(ctx, [
      proposeAddToCalendarTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('propose_add_to_calendar', {
      title: 'Dinner',
      starts_at: 'not-a-date',
      mirror_to_gcal: false,
    });
    expect(res.ok).toBe(false);
  });
});

describe('propose_book_reservation tool', () => {
  it('inserts a pending food-segment reservation suggestion', async () => {
    const inserts: InsertRecord[] = [];
    const sb = makeSupabase(inserts);
    const ctx = mkCtx(sb);
    const res = await proposeBookReservationTool.handler(
      {
        venue_name: "Joe's Tavern",
        party_size: 4,
        proposed_times: ['2026-04-20T19:00:00Z', '2026-04-20T20:00:00Z'],
      },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    const insert = inserts.find((i) => i.table === 'suggestion');
    expect(insert?.row['segment']).toBe('food');
    expect(insert?.row['kind']).toBe('propose_book_reservation');
  });

  it('catalog gate rejects callers without food:write', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb, { grants: [{ segment: 'food', access: 'read' }] });
    const catalog = createToolCatalogFromDefinitions(ctx, [
      proposeBookReservationTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('propose_book_reservation', {
      venue_name: "Joe's",
      party_size: 2,
      proposed_times: ['2026-04-20T19:00:00Z'],
    });
    expect(res.ok).toBe(false);
  });

  it('rejects empty proposed_times', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb);
    const catalog = createToolCatalogFromDefinitions(ctx, [
      proposeBookReservationTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('propose_book_reservation', {
      venue_name: "Joe's",
      party_size: 2,
      proposed_times: [],
    });
    expect(res.ok).toBe(false);
  });
});

describe('settle_shared_expense tool', () => {
  it('inserts a pending settle_shared_expense suggestion', async () => {
    const inserts: InsertRecord[] = [];
    const sb = makeSupabase(inserts);
    const ctx = mkCtx(sb);
    const res = await settleSharedExpenseTool.handler(
      {
        counterparty_member_id: '00000000-0000-0000-0000-000000000099',
        amount_cents: 4_200,
        currency: 'USD',
        direction: 'owe_them',
        reason: 'dinner split',
      },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    const insert = inserts.find((i) => i.table === 'suggestion');
    expect(insert?.row['kind']).toBe('settle_shared_expense');
    expect(insert?.row['segment']).toBe('financial');
  });

  it('catalog gate rejects callers without financial:write', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb, { grants: [{ segment: 'financial', access: 'read' }] });
    const catalog = createToolCatalogFromDefinitions(ctx, [
      settleSharedExpenseTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('settle_shared_expense', {
      counterparty_member_id: '00000000-0000-0000-0000-000000000099',
      amount_cents: 100,
      currency: 'USD',
      direction: 'owe_them',
      reason: 'x',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects bad input (negative amount)', async () => {
    const sb = makeSupabase([]);
    const ctx = mkCtx(sb);
    const catalog = createToolCatalogFromDefinitions(ctx, [
      settleSharedExpenseTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await catalog.call('settle_shared_expense', {
      counterparty_member_id: '00000000-0000-0000-0000-000000000099',
      amount_cents: -10,
      currency: 'USD',
      direction: 'owe_them',
      reason: 'x',
    });
    expect(res.ok).toBe(false);
  });
});
