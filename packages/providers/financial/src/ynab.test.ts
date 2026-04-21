/**
 * Unit tests for `YnabProvider`.
 *
 * Strategy: mock the `NangoClient` entirely. We pin:
 *   - Milliunit → cents conversion.
 *   - Account-kind mapping (including unmapped fallback).
 *   - Transaction normalization (deleted / cleared / payee).
 *   - Budget-id selection (stored → used; absent → first budget).
 *   - Delta sync passes `last_knowledge_of_server` on the URL.
 *   - 409 knowledge_out_of_date → `CursorExpiredError`.
 *   - 429 → `RateLimitError` with the default retry window.
 */

import { NangoError, type NangoClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import { CursorExpiredError, RateLimitError } from './errors.js';
import { __internal, createYnabProvider, milliunitsToCents } from './ynab.js';

function makeNango(
  proxyImpl: (opts: {
    endpoint: string;
    method?: string;
    params?: Record<string, unknown>;
  }) => unknown,
): NangoClient {
  return {
    proxy: vi.fn(async (opts) => proxyImpl(opts) as never),
    getConnection: vi.fn(),
    listConnections: vi.fn(),
  } as unknown as NangoClient;
}

function makeNangoError(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): NangoError {
  return new NangoError(
    'proxy failed',
    { providerConfigKey: 'ynab', connectionId: 'c1' },
    {
      cause: { response: { status, data: body, headers: headers ?? {} } },
    },
  );
}

// --- milliunit + kind ---------------------------------------------------

describe('milliunitsToCents', () => {
  it('converts whole USD values', () => {
    expect(milliunitsToCents(12_340)).toBe(1234);
    expect(milliunitsToCents(-5_000)).toBe(-500);
    expect(milliunitsToCents(0)).toBe(0);
  });
  it('defaults undefined / non-finite to 0', () => {
    expect(milliunitsToCents(undefined)).toBe(0);
    expect(milliunitsToCents(Number.NaN)).toBe(0);
  });
});

describe('mapAccountKind', () => {
  it('maps creditCard + lineOfCredit to credit', () => {
    expect(__internal.mapAccountKind('creditCard')).toBe('credit');
    expect(__internal.mapAccountKind('lineOfCredit')).toBe('credit');
  });
  it('maps loan-like types to loan', () => {
    expect(__internal.mapAccountKind('mortgage')).toBe('loan');
    expect(__internal.mapAccountKind('studentLoan')).toBe('loan');
  });
  it('falls back to checking for unknown types', () => {
    expect(__internal.mapAccountKind('somethingWeird')).toBe('checking');
  });
});

// --- normalizeTransaction ----------------------------------------------

describe('normalizeTransaction', () => {
  it('drops deleted / missing-id rows', () => {
    expect(__internal.normalizeTransaction({ id: 't1', deleted: true, date: '2026-04-20' })).toBe(
      null,
    );
    expect(__internal.normalizeTransaction({ date: '2026-04-20' })).toBe(null);
    expect(__internal.normalizeTransaction({ id: 't1' })).toBe(null);
  });
  it('marks cleared for cleared + reconciled', () => {
    for (const cleared of ['cleared', 'reconciled']) {
      const tx = __internal.normalizeTransaction({
        id: 't1',
        account_id: 'a1',
        date: '2026-04-20',
        amount: -12_340,
        cleared,
      });
      expect(tx?.cleared).toBe(true);
    }
    const uncleared = __internal.normalizeTransaction({
      id: 't2',
      account_id: 'a1',
      date: '2026-04-20',
      amount: -1_000,
      cleared: 'uncleared',
    });
    expect(uncleared?.cleared).toBe(false);
  });
  it('folds milliunits into cents and carries payee + category', () => {
    const tx = __internal.normalizeTransaction({
      id: 't1',
      account_id: 'a1',
      date: '2026-04-20',
      amount: -12_340,
      payee_name: 'Blue Bottle',
      category_name: 'Coffee',
      memo: 'latte',
      cleared: 'cleared',
    });
    expect(tx?.amountCents).toBe(-1234);
    expect(tx?.merchantRaw).toBe('Blue Bottle');
    expect(tx?.category).toBe('Coffee');
    expect(tx?.memo).toBe('latte');
  });
});

// --- listAccounts + budget-id resolution --------------------------------

describe('createYnabProvider — listAccounts', () => {
  it('uses the stored ynab_budget_id when present', async () => {
    const calls: string[] = [];
    const nango = makeNango((opts) => {
      calls.push(opts.endpoint);
      if (opts.endpoint.endsWith('/accounts')) {
        return {
          data: {
            accounts: [
              {
                id: 'a1',
                name: 'Checking',
                type: 'checking',
                balance: 1_234_000,
                deleted: false,
              },
              {
                id: 'a2',
                name: 'Credit',
                type: 'creditCard',
                balance: -500_000,
                deleted: false,
              },
              {
                id: 'a3',
                name: 'Old',
                type: 'checking',
                balance: 0,
                deleted: true,
              },
            ],
            server_knowledge: 42,
          },
        };
      }
      throw new Error(`unexpected endpoint ${opts.endpoint}`);
    });

    const provider = createYnabProvider({
      nango,
      resolveBudgetId: async () => 'budget-123',
    });
    const accounts = await provider.listAccounts({ connectionId: 'c1' });
    expect(calls).toEqual(['/v1/budgets/budget-123/accounts']);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ sourceId: 'a1', kind: 'checking', balanceCents: 123_400 });
    expect(accounts[1]).toMatchObject({ sourceId: 'a2', kind: 'credit', balanceCents: -50_000 });
  });

  it('falls back to /v1/budgets when no budget id is stored', async () => {
    const calls: string[] = [];
    const nango = makeNango((opts) => {
      calls.push(opts.endpoint);
      if (opts.endpoint === '/v1/budgets') {
        return {
          data: {
            budgets: [{ id: 'auto-budget', name: 'Primary' }],
            default_budget: null,
          },
        };
      }
      return { data: { accounts: [], server_knowledge: 0 } };
    });

    const provider = createYnabProvider({
      nango,
      resolveBudgetId: async () => undefined,
    });
    await provider.listAccounts({ connectionId: 'c1' });
    expect(calls).toEqual(['/v1/budgets', '/v1/budgets/auto-budget/accounts']);
  });

  it('prefers default_budget when present', async () => {
    const calls: string[] = [];
    const nango = makeNango((opts) => {
      calls.push(opts.endpoint);
      if (opts.endpoint === '/v1/budgets') {
        return {
          data: {
            budgets: [
              { id: 'other', name: 'Other' },
              { id: 'default', name: 'Primary' },
            ],
            default_budget: { id: 'default', name: 'Primary' },
          },
        };
      }
      return { data: { accounts: [] } };
    });

    const provider = createYnabProvider({
      nango,
      resolveBudgetId: async () => undefined,
    });
    await provider.listAccounts({ connectionId: 'c1' });
    expect(calls[1]).toBe('/v1/budgets/default/accounts');
  });
});

// --- listTransactions ---------------------------------------------------

describe('createYnabProvider — listTransactions', () => {
  it('emits a single page with the server_knowledge cursor', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint.endsWith('/transactions')) {
        return {
          data: {
            transactions: [
              {
                id: 't1',
                date: '2026-04-19',
                amount: -12_340,
                payee_name: 'Blue Bottle',
                category_name: 'Coffee',
                account_id: 'a1',
                cleared: 'cleared',
              },
            ],
            server_knowledge: 99,
          },
        };
      }
      throw new Error('unexpected');
    });
    const provider = createYnabProvider({
      nango,
      resolveBudgetId: async () => 'b1',
    });
    const pages = [];
    for await (const page of provider.listTransactions({ connectionId: 'c1' })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(1);
    expect(pages[0]?.transactions).toHaveLength(1);
    expect(pages[0]?.nextCursor).toBe('99');
  });

  it('passes last_knowledge_of_server when sinceCursor supplied', async () => {
    const capturedParams: Array<Record<string, unknown>> = [];
    const nango = makeNango((opts) => {
      if (opts.endpoint.endsWith('/transactions')) {
        capturedParams.push(opts.params ?? {});
        return { data: { transactions: [], server_knowledge: 100 } };
      }
      throw new Error('unexpected');
    });
    const provider = createYnabProvider({
      nango,
      resolveBudgetId: async () => 'b1',
    });
    for await (const _ of provider.listTransactions({
      connectionId: 'c1',
      sinceCursor: '50',
    })) {
      // drain
    }
    expect(capturedParams[0]).toEqual({ last_knowledge_of_server: '50' });
    expect(capturedParams[0]).not.toHaveProperty('since_date');
  });

  it('maps 409 knowledge_out_of_date to CursorExpiredError', async () => {
    const nango = makeNango(() => {
      throw makeNangoError(409, { error: { id: 'knowledge_out_of_date' } });
    });
    const provider = createYnabProvider({
      nango,
      resolveBudgetId: async () => 'b1',
    });
    await expect(async () => {
      for await (const _ of provider.listTransactions({
        connectionId: 'c1',
        sinceCursor: '1',
      })) {
        // drain
      }
    }).rejects.toBeInstanceOf(CursorExpiredError);
  });

  it('maps 429 to RateLimitError', async () => {
    const nango = makeNango(() => {
      throw makeNangoError(429);
    });
    const provider = createYnabProvider({
      nango,
      resolveBudgetId: async () => 'b1',
    });
    try {
      for await (const _ of provider.listTransactions({ connectionId: 'c1' })) {
        // drain
      }
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      // Default window is 300s.
      expect((err as RateLimitError).retryAfterSeconds).toBe(300);
    }
  });
});

// --- listBudgets --------------------------------------------------------

describe('createYnabProvider — listBudgets', () => {
  it('flattens category groups into monthly budget entries', async () => {
    const nango = makeNango((opts) => {
      if (opts.endpoint.endsWith('/categories')) {
        return {
          data: {
            category_groups: [
              {
                id: 'g1',
                name: 'Everyday',
                hidden: false,
                categories: [
                  { id: 'c1', name: 'Groceries', budgeted: 500_000 },
                  { id: 'c2', name: 'Dining', budgeted: 120_000 },
                  { id: 'c3', name: 'Hidden', budgeted: 0, hidden: true },
                ],
              },
              {
                id: 'g2',
                name: 'Internal Master Category',
                hidden: true,
                categories: [{ id: 'c4', name: 'Inflow', budgeted: 0 }],
              },
            ],
          },
        };
      }
      throw new Error('unexpected');
    });
    const provider = createYnabProvider({
      nango,
      resolveBudgetId: async () => 'b1',
    });
    const budgets = await provider.listBudgets({ connectionId: 'c1' });
    expect(budgets).toHaveLength(2);
    expect(budgets[0]).toMatchObject({
      sourceId: 'c1',
      category: 'Groceries',
      amountCents: 50_000,
      period: 'monthly',
    });
    expect(budgets[1]?.category).toBe('Dining');
  });
});
