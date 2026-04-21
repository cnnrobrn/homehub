/**
 * Foreground-agent orchestration tests.
 *
 * We mock: the foreground model (deterministic tool-call sequences),
 * the tool catalog (so we can assert dispatch), and the Supabase
 * service client (no-op). Goal: prove the event-order contract the
 * web route handler relies on.
 */

import { describe, expect, it, vi } from 'vitest';

import { collectStream, runConversationTurnStream } from './handler.js';

import type { ForegroundModel } from './model.js';
import type { ToolCatalog, ToolContext } from '@homehub/tools';

function mkSupabase(): {
  calls: string[];
  client: unknown;
} {
  const calls: string[] = [];
  const mkBuilder = (): unknown => {
    const chain = () => thenable;
    const thenable: Record<string, unknown> & {
      then: (r: (v: { data: unknown; error: null }) => unknown) => unknown;
    } = {
      select: chain,
      eq: chain,
      in: chain,
      is: chain,
      order: chain,
      limit: chain,
      gte: chain,
      lt: chain,
      update: chain,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: 'assistant-turn-1' }, error: null }),
      insert: () => {
        calls.push('insert');
        return {
          select: () => ({
            single: async () => ({ data: { id: 'assistant-turn-1' }, error: null }),
          }),
        };
      },
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    };
    return thenable;
  };
  return {
    calls,
    client: {
      schema(name: string) {
        calls.push(`schema:${name}`);
        return {
          from(table: string) {
            calls.push(`from:${table}`);
            return mkBuilder();
          },
        };
      },
    },
  };
}

function mkQueryMemory() {
  return {
    query: vi.fn(async () => ({
      nodes: [],
      edges: [],
      facts: [],
      episodes: [],
      patterns: [],
      conflicts: [],
    })),
  };
}

function mkModelClient() {
  return {
    generate: vi.fn(async () => ({
      text: JSON.stringify({
        intent: 'ask',
        entities: [],
        retrieval_depth: 'shallow',
        segments: [],
      }),
      parsed: {
        intent: 'ask',
        entities: [],
        retrieval_depth: 'shallow',
        segments: [],
      },
      model: 'kimi',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencyMs: 1,
    })),
    embed: vi.fn(),
  };
}

function mkLogger() {
  const base = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => base),
  };
  return base;
}

describe('runConversationTurnStream', () => {
  it('yields start → intent → final when model returns no tool calls', async () => {
    const sb = mkSupabase();
    const fgModel: ForegroundModel = {
      generate: vi.fn(async () => ({
        assistantText: 'Hello!',
        toolCalls: [],
        model: 'claude-sonnet-4.5',
        inputTokens: 10,
        outputTokens: 3,
        costUsd: 0.0001,
        latencyMs: 5,
        finishReason: 'stop',
      })),
    };
    const events = await collectStream(
      runConversationTurnStream(
        {
          conversationId: 'c1',
          turnId: 't1',
          memberMessage: 'hi',
          memberContext: {
            householdId: 'hh-1' as never,
            memberId: 'm-1' as never,
            memberRole: 'adult',
            grants: [],
          },
        },
        {
          supabase: sb.client as never,
          queryMemory: mkQueryMemory() as never,
          modelClient: mkModelClient() as never,
          foregroundModel: fgModel,
          queue: null,
          logger: mkLogger() as never,
        },
      ),
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(types).toContain('intent');
    expect(types[types.length - 1]).toBe('final');
    // Assistant tokens streamed.
    expect(types.filter((t) => t === 'token').length).toBeGreaterThan(0);
  });

  it('dispatches read tool calls in order and feeds the result back to the model', async () => {
    const sb = mkSupabase();
    let modelTurn = 0;
    const fgModel: ForegroundModel = {
      generate: vi.fn(async () => {
        modelTurn += 1;
        if (modelTurn === 1) {
          return {
            assistantText: '',
            toolCalls: [{ id: 'c1', name: 'query_memory', arguments: { query: 'hi' } }],
            model: 'claude-sonnet-4.5',
            inputTokens: 5,
            outputTokens: 1,
            costUsd: 0,
            latencyMs: 1,
            finishReason: 'tool_calls',
          };
        }
        return {
          assistantText: 'Found some stuff.',
          toolCalls: [],
          model: 'claude-sonnet-4.5',
          inputTokens: 6,
          outputTokens: 3,
          costUsd: 0,
          latencyMs: 1,
          finishReason: 'stop',
        };
      }),
    };
    const mockCall = vi.fn(async () => ({
      ok: true as const,
      result: { nodes: [], edges: [], facts: [], episodes: [], patterns: [], conflicts: [] },
      classification: 'read' as const,
    }));
    const catalog: ToolCatalog = {
      definitions: [],
      forModel: () => [
        {
          type: 'function',
          function: {
            name: 'query_memory',
            description: 'read memory',
            parameters: { type: 'object' },
          },
        },
      ],
      call: mockCall,
      definition: () => undefined,
    };
    const events = await collectStream(
      runConversationTurnStream(
        {
          conversationId: 'c1',
          turnId: 't1',
          memberMessage: 'what do you remember?',
          memberContext: {
            householdId: 'hh-1' as never,
            memberId: 'm-1' as never,
            memberRole: 'adult',
            grants: [],
          },
        },
        {
          supabase: sb.client as never,
          queryMemory: mkQueryMemory() as never,
          modelClient: mkModelClient() as never,
          foregroundModel: fgModel,
          queue: null,
          logger: mkLogger() as never,
          catalogFactory: (_ctx: ToolContext) => catalog,
        },
      ),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call_start');
    expect(types).toContain('tool_call_done');
    // tool_call_start must precede tool_call_done.
    expect(types.indexOf('tool_call_start')).toBeLessThan(types.indexOf('tool_call_done'));
    expect(mockCall).toHaveBeenCalledWith('query_memory', { query: 'hi' });
    // Final comes after tokens.
    expect(types[types.length - 1]).toBe('final');
  });

  it('emits a suggestion_card event when a draft-write tool completes', async () => {
    const sb = mkSupabase();
    let turn = 0;
    const fgModel: ForegroundModel = {
      generate: vi.fn(async () => {
        turn += 1;
        if (turn === 1) {
          return {
            assistantText: '',
            toolCalls: [
              {
                id: 'c1',
                name: 'propose_transfer',
                arguments: {
                  from_account: '00000000-0000-0000-0000-000000000001',
                  to_account: '00000000-0000-0000-0000-000000000002',
                  amount_cents: 10_000,
                  reason: 'savings',
                },
              },
            ],
            model: 'claude-sonnet-4.5',
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            latencyMs: 1,
            finishReason: 'tool_calls',
          };
        }
        return {
          assistantText: 'Proposed.',
          toolCalls: [],
          model: 'claude-sonnet-4.5',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          latencyMs: 1,
          finishReason: 'stop',
        };
      }),
    };
    const catalog: ToolCatalog = {
      definitions: [],
      forModel: () => [
        {
          type: 'function',
          function: {
            name: 'propose_transfer',
            description: 'draft a transfer',
            parameters: { type: 'object' },
          },
        },
      ],
      call: vi.fn(async () => ({
        ok: true as const,
        result: { status: 'pending_approval', summary: 'Transfer $100: savings', preview: {} },
        classification: 'draft-write' as const,
      })),
      definition: () =>
        ({
          name: 'propose_transfer',
          class: 'draft-write',
          description: '',
          input: { safeParse: () => ({ success: true, data: {} }) } as never,
          output: { safeParse: () => ({ success: true, data: {} }) } as never,
          segments: ['financial'],
          handler: async () => ({}) as never,
        }) as never,
    };
    const events = await collectStream(
      runConversationTurnStream(
        {
          conversationId: 'c1',
          turnId: 't1',
          memberMessage: 'move $100 to savings',
          memberContext: {
            householdId: 'hh-1' as never,
            memberId: 'm-1' as never,
            memberRole: 'adult',
            grants: [{ segment: 'financial', access: 'write' }],
          },
        },
        {
          supabase: sb.client as never,
          queryMemory: mkQueryMemory() as never,
          modelClient: mkModelClient() as never,
          foregroundModel: fgModel,
          queue: null,
          logger: mkLogger() as never,
          catalogFactory: () => catalog,
        },
      ),
    );
    expect(events.some((e) => e.type === 'suggestion_card')).toBe(true);
  });

  it('surfaces tool errors as a tool_call_error event without aborting the turn', async () => {
    const sb = mkSupabase();
    let turn = 0;
    const fgModel: ForegroundModel = {
      generate: vi.fn(async () => {
        turn += 1;
        if (turn === 1) {
          return {
            assistantText: '',
            toolCalls: [{ id: 'c1', name: 'list_events', arguments: {} }],
            model: 'claude-sonnet-4.5',
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            latencyMs: 1,
            finishReason: 'tool_calls',
          };
        }
        return {
          assistantText: 'Sorry, could not fetch events.',
          toolCalls: [],
          model: 'claude-sonnet-4.5',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          latencyMs: 1,
          finishReason: 'stop',
        };
      }),
    };
    const catalog: ToolCatalog = {
      definitions: [],
      forModel: () => [],
      call: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'tool_validation', message: 'missing from/to' },
      })),
      definition: () => undefined,
    };
    const events = await collectStream(
      runConversationTurnStream(
        {
          conversationId: 'c1',
          turnId: 't1',
          memberMessage: 'events?',
          memberContext: {
            householdId: 'hh-1' as never,
            memberId: 'm-1' as never,
            memberRole: 'adult',
            grants: [{ segment: 'fun', access: 'read' }],
          },
        },
        {
          supabase: sb.client as never,
          queryMemory: mkQueryMemory() as never,
          modelClient: mkModelClient() as never,
          foregroundModel: fgModel,
          queue: null,
          logger: mkLogger() as never,
          catalogFactory: () => catalog,
        },
      ),
    );
    expect(events.some((e) => e.type === 'tool_call_error')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('final');
  });
});

describe('runConversationTurn legacy shim', () => {
  it('drains the stream when provided with deps', async () => {
    const sb = mkSupabase();
    const fgModel: ForegroundModel = {
      generate: vi.fn(async () => ({
        assistantText: 'ok',
        toolCalls: [],
        model: 'm',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        finishReason: 'stop',
      })),
    };
    const { runConversationTurn } = await import('./handler.js');
    await expect(
      runConversationTurn(
        {
          conversationId: 'c1',
          turnId: 't1',
          memberMessage: 'hi',
          memberContext: {
            householdId: 'hh-1' as never,
            memberId: 'm-1' as never,
            memberRole: 'adult',
            grants: [],
          },
        },
        {
          supabase: sb.client as never,
          queryMemory: mkQueryMemory() as never,
          modelClient: mkModelClient() as never,
          foregroundModel: fgModel,
          queue: null,
          logger: mkLogger() as never,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
