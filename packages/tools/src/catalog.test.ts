/**
 * Catalog-level tests: segment gating, role gating, input/output
 * validation, forbidden-path behavior, and the OpenAI tool-spec shape.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createToolCatalogFromDefinitions, readableSegments } from './catalog.js';

import type { ToolContext, ToolDefinition } from './types.js';

function mkCtx(overrides: Partial<ToolContext> = {}): ToolContext {
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
      { segment: 'financial', access: 'read' },
      { segment: 'food', access: 'write' },
      { segment: 'fun', access: 'read' },
      { segment: 'social', access: 'read' },
      { segment: 'system', access: 'read' },
    ],
    supabase: {} as ToolContext['supabase'],
    queryMemory: { query: vi.fn() } as unknown as ToolContext['queryMemory'],
    log: logger as unknown as ToolContext['log'],
    ...overrides,
  };
}

const readTool: ToolDefinition<{ a: number }, { out: number }> = {
  name: 't_read',
  description: 'test read',
  class: 'read',
  input: z.object({ a: z.number() }),
  output: z.object({ out: z.number() }),
  segments: 'all',
  async handler(args) {
    return { out: args.a + 1 };
  },
};

const foodReadTool: ToolDefinition<{ x: string }, { ok: boolean }> = {
  name: 't_food_read',
  description: 'food read',
  class: 'read',
  input: z.object({ x: z.string() }),
  output: z.object({ ok: z.boolean() }),
  segments: ['food'],
  async handler() {
    return { ok: true };
  },
};

const foodWriteTool: ToolDefinition<Record<string, never>, { ok: boolean }> = {
  name: 't_food_write',
  description: 'food write',
  class: 'direct-write',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  segments: ['food'],
  async handler() {
    return { ok: true };
  },
};

const ownerTool: ToolDefinition<Record<string, never>, { ok: true }> = {
  name: 't_owner',
  description: 'owner only',
  class: 'direct-write',
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  segments: 'all',
  requiresRole: 'owner',
  async handler() {
    return { ok: true };
  },
};

describe('createToolCatalog', () => {
  it('calls a read tool with valid input', async () => {
    const ctx = mkCtx();
    const cat = createToolCatalogFromDefinitions(ctx, [
      readTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await cat.call('t_read', { a: 4 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toEqual({ out: 5 });
      expect(res.classification).toBe('read');
    }
  });

  it('returns tool_not_found for unknown tool name', async () => {
    const ctx = mkCtx();
    const cat = createToolCatalogFromDefinitions(ctx, []);
    const res = await cat.call('missing', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('tool_not_found');
  });

  it('returns validation error on bad input', async () => {
    const ctx = mkCtx();
    const cat = createToolCatalogFromDefinitions(ctx, [
      readTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await cat.call('t_read', { a: 'not a number' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('tool_validation');
  });

  it('forbids read tool without read grant', async () => {
    const ctx = mkCtx({
      grants: [{ segment: 'financial', access: 'read' }],
    });
    const cat = createToolCatalogFromDefinitions(ctx, [
      foodReadTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await cat.call('t_food_read', { x: 'q' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('tool_forbidden');
  });

  it('forbids write tool when member has only read on segment', async () => {
    const ctx = mkCtx({
      grants: [{ segment: 'food', access: 'read' }],
    });
    const cat = createToolCatalogFromDefinitions(ctx, [
      foodWriteTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await cat.call('t_food_write', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('tool_forbidden');
  });

  it('owner can call adult-required tool', async () => {
    const adultTool: ToolDefinition<Record<string, never>, { ok: true }> = {
      ...ownerTool,
      name: 't_adult',
      requiresRole: 'adult',
    };
    const ctx = mkCtx({ memberRole: 'owner' });
    const cat = createToolCatalogFromDefinitions(ctx, [
      adultTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await cat.call('t_adult', {});
    expect(res.ok).toBe(true);
  });

  it('role gate blocks non-owners on owner-required tool', async () => {
    const ctx = mkCtx({ memberRole: 'adult' });
    const cat = createToolCatalogFromDefinitions(ctx, [
      ownerTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await cat.call('t_owner', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('tool_forbidden');
  });

  it('forModel filters by segment scope', () => {
    const ctx = mkCtx();
    const cat = createToolCatalogFromDefinitions(ctx, [
      readTool as ToolDefinition<unknown, unknown>,
      foodReadTool as ToolDefinition<unknown, unknown>,
      {
        ...foodReadTool,
        name: 't_financial_read',
        segments: ['financial'],
      } as ToolDefinition<unknown, unknown>,
    ]);
    const allSpecs = cat.forModel();
    expect(allSpecs.map((s) => s.function.name).sort()).toEqual(
      ['t_financial_read', 't_food_read', 't_read'].sort(),
    );
    // When scope is `['food']`, the financial-only tool drops out.
    const foodOnly = cat.forModel(['food']);
    expect(foodOnly.map((s) => s.function.name).sort()).toEqual(['t_food_read', 't_read'].sort());
  });

  it('forModel emits object-typed parameters', () => {
    const ctx = mkCtx();
    const cat = createToolCatalogFromDefinitions(ctx, [
      readTool as ToolDefinition<unknown, unknown>,
    ]);
    const specs = cat.forModel();
    expect(specs[0]?.type).toBe('function');
    expect(specs[0]?.function.parameters).toMatchObject({ type: 'object' });
  });

  it('rejects handler output that fails the output schema', async () => {
    const badTool: ToolDefinition<{ a: number }, { out: number }> = {
      ...readTool,
      name: 't_bad',
      async handler() {
        return { out: 'not a number' as unknown as number };
      },
    };
    const ctx = mkCtx();
    const cat = createToolCatalogFromDefinitions(ctx, [
      badTool as ToolDefinition<unknown, unknown>,
    ]);
    const res = await cat.call('t_bad', { a: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('tool_output_invalid');
  });
});

describe('readableSegments', () => {
  it('filters out none grants', () => {
    expect(
      readableSegments([
        { segment: 'financial', access: 'read' },
        { segment: 'food', access: 'none' },
        { segment: 'fun', access: 'write' },
      ]),
    ).toEqual(['financial', 'fun']);
  });
});
