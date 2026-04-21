/**
 * Unit tests for the `embed_node` handler primitive (M3.5).
 */

import { type Logger, type ModelClient } from '@homehub/worker-runtime';
import { describe, expect, it, vi } from 'vitest';

import { composeEmbeddingText, EMBED_DOCUMENT_MD_MAX_CHARS, embedNodeOne } from './embed-node.js';

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

interface NodeFixture {
  id: string;
  household_id: string;
  canonical_name: string;
  document_md: string | null;
}

interface AliasFixture {
  node_id: string;
  alias: string;
}

function makeFakeSupabase(init: {
  node?: NodeFixture | null;
  aliases?: AliasFixture[];
  nodeError?: string;
  aliasError?: string;
  updateError?: string;
}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const supabase = {
    schema(name: string) {
      if (name !== 'mem') throw new Error(`unexpected schema ${name}`);
      return {
        from(table: string) {
          if (table === 'node') {
            const filters: Record<string, string> = {};
            let mode: 'select' | 'update' = 'select';
            let patch: Record<string, unknown> = {};
            const chain: Record<string, unknown> = {
              select() {
                mode = 'select';
                return chain;
              },
              eq(col: string, val: string) {
                filters[col] = val;
                if (mode === 'update') {
                  if (init.updateError) {
                    return Promise.resolve({ data: null, error: { message: init.updateError } });
                  }
                  updates.push({ id: filters.id as string, patch });
                  return Promise.resolve({ data: null, error: null });
                }
                return chain;
              },
              async maybeSingle() {
                if (init.nodeError) {
                  return { data: null, error: { message: init.nodeError } };
                }
                return { data: init.node ?? null, error: null };
              },
              update(p: Record<string, unknown>) {
                mode = 'update';
                patch = p;
                return chain;
              },
            };
            return chain;
          }
          if (table === 'alias') {
            const chain: Record<string, unknown> = {
              select() {
                return chain;
              },
              eq(_col: string, _val: string) {
                return chain;
              },
            };
            (chain as Record<string, unknown>).then = (fulfill: (v: unknown) => unknown) => {
              if (init.aliasError) {
                return Promise.resolve(
                  fulfill({ data: null, error: { message: init.aliasError } }),
                );
              }
              return Promise.resolve(fulfill({ data: init.aliases ?? [], error: null }));
            };
            return chain;
          }
          throw new Error(`unexpected mem.${table}`);
        },
      };
    },
  };

  return { supabase, updates };
}

const HOUSEHOLD_ID = 'a0000000-0000-4000-8000-000000000001';
const NODE_ID = 'n0000000-0000-4000-8000-000000000001';

describe('composeEmbeddingText', () => {
  it('joins canonical_name, truncated document_md, and aliases', () => {
    const docMd = 'a'.repeat(EMBED_DOCUMENT_MD_MAX_CHARS + 100);
    const text = composeEmbeddingText({
      node: { canonical_name: 'Sarah', document_md: docMd },
      aliases: ['sarah@example.com', 'S.'],
    });
    expect(text.startsWith('Sarah ')).toBe(true);
    expect(text).toContain('sarah@example.com');
    expect(text).toContain('S.');
    // Document_md portion must not exceed EMBED_DOCUMENT_MD_MAX_CHARS chars.
    expect(text.length).toBeLessThan(
      'Sarah '.length + EMBED_DOCUMENT_MD_MAX_CHARS + ' sarah@example.com S.'.length + 5,
    );
  });

  it('returns empty string when all inputs are empty', () => {
    expect(
      composeEmbeddingText({ node: { canonical_name: '', document_md: null }, aliases: [] }),
    ).toBe('');
  });
});

describe('embedNodeOne', () => {
  it('embeds a node with canonical_name and updates mem.node.embedding', async () => {
    const { supabase, updates } = makeFakeSupabase({
      node: {
        id: NODE_ID,
        household_id: HOUSEHOLD_ID,
        canonical_name: 'Sarah',
        document_md: 'Sarah is the 7-year-old who likes cheese.',
      },
      aliases: [{ node_id: NODE_ID, alias: 's.' }],
    });
    const embed = vi.fn(async () => ({
      embedding: new Array(1536).fill(0.1),
      model: 'openai/text-embedding-3-small',
      inputTokens: 10,
      costUsd: 0,
      latencyMs: 15,
    }));
    const modelClient = { embed, generate: vi.fn() } as unknown as ModelClient;

    const result = await embedNodeOne(
      { supabase: supabase as never, modelClient, log: makeLog() },
      { household_id: HOUSEHOLD_ID, entity_id: NODE_ID },
    );

    expect(result.embedded).toBe(true);
    expect(result.dimensions).toBe(1536);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe(NODE_ID);
    expect(updates[0]?.patch.embedding).toBeDefined();
    expect(embed).toHaveBeenCalled();
  });

  it('throws when the node is missing', async () => {
    const { supabase } = makeFakeSupabase({ node: null });
    const modelClient = {
      embed: vi.fn(),
      generate: vi.fn(),
    } as unknown as ModelClient;

    await expect(
      embedNodeOne(
        { supabase: supabase as never, modelClient, log: makeLog() },
        { household_id: HOUSEHOLD_ID, entity_id: NODE_ID },
      ),
    ).rejects.toThrow(/mem.node not found/);
  });

  it('short-circuits when composed text is empty', async () => {
    const { supabase, updates } = makeFakeSupabase({
      node: {
        id: NODE_ID,
        household_id: HOUSEHOLD_ID,
        canonical_name: '',
        document_md: null,
      },
      aliases: [],
    });
    const embed = vi.fn();
    const modelClient = { embed, generate: vi.fn() } as unknown as ModelClient;

    const result = await embedNodeOne(
      { supabase: supabase as never, modelClient, log: makeLog() },
      { household_id: HOUSEHOLD_ID, entity_id: NODE_ID },
    );

    expect(result.embedded).toBe(false);
    expect(updates).toHaveLength(0);
    expect(embed).not.toHaveBeenCalled();
  });
});
