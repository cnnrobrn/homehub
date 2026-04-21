/**
 * `query_memory` — layer-aware hybrid retrieval.
 *
 * Delegates to `@homehub/query-memory`. Retrieval is always available
 * (every segment), so the segment gate is `'all'`.
 */

import { NODE_TYPES } from '@homehub/shared';
import { z } from 'zod';

import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  query: z.string().min(1),
  layers: z.array(z.enum(['episodic', 'semantic', 'procedural'])).optional(),
  types: z.array(z.enum(NODE_TYPES)).optional(),
  include_documents: z.boolean().optional(),
  include_conflicts: z.boolean().optional(),
  max_depth: z.number().int().min(0).max(4).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  as_of: z.string().datetime().optional(),
});

const outputSchema = z.object({
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  facts: z.array(z.unknown()),
  episodes: z.array(z.unknown()),
  patterns: z.array(z.unknown()),
  conflicts: z.array(z.unknown()),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const queryMemoryTool: ToolDefinition<Input, Output> = {
  name: 'query_memory',
  description:
    "Search the household's memory graph. Returns matching nodes, facts, episodes, rules, and flagged conflicts.",
  class: 'read',
  input: inputSchema,
  output: outputSchema,
  segments: 'all',
  async handler(args, ctx) {
    const result = await ctx.queryMemory.query({
      householdId: ctx.householdId,
      query: args.query,
      ...(args.layers ? { layers: args.layers } : {}),
      ...(args.types ? { types: args.types } : {}),
      ...(args.include_documents !== undefined
        ? { include_documents: args.include_documents }
        : {}),
      ...(args.include_conflicts !== undefined
        ? { include_conflicts: args.include_conflicts }
        : {}),
      ...(args.max_depth !== undefined ? { max_depth: args.max_depth } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.as_of ? { as_of: args.as_of } : {}),
    });
    return result;
  },
};
