/**
 * `query_memory` MCP tool.
 *
 * Thin wrapper around `@homehub/query-memory.createQueryMemory` — the
 * tool resolves `householdId` from the caller's auth context and
 * forwards every other field straight through. No ranking or scoping
 * is reimplemented here; that's the query-memory package's job.
 *
 * Spec: `specs/04-memory-network/retrieval.md`.
 */

import {
  type QueryMemoryArgs,
  type QueryMemoryClient,
  type QueryMemoryResult,
} from '@homehub/query-memory';
import { NODE_TYPES, type HouseholdId, type NodeType } from '@homehub/shared';
import { z } from 'zod';

import { type AuthContext } from '../middleware/auth.js';

import { jsonResult, parseOrThrow, type ToolResult } from './result.js';

export const QUERY_MEMORY_TOOL_NAME = 'query_memory';

export const QUERY_MEMORY_DESCRIPTION =
  "Query the household's memory graph. Returns nodes, edges, facts, episodes, patterns, and unresolved conflicts.";

export const queryMemoryInputShape = {
  query: z.string().min(1),
  layers: z.array(z.enum(['episodic', 'semantic', 'procedural'])).optional(),
  types: z.array(z.enum(NODE_TYPES)).optional(),
  include_documents: z.boolean().default(true),
  include_conflicts: z.boolean().default(true),
  max_depth: z.number().int().min(0).max(4).default(2),
  limit: z.number().int().min(1).max(50).default(10),
  as_of: z.string().datetime().optional(),
  recency_half_life_days: z.number().int().positive().max(365).optional(),
} as const;

export const queryMemoryInputSchema = z.object(queryMemoryInputShape);
export type QueryMemoryInput = z.infer<typeof queryMemoryInputSchema>;

export interface QueryMemoryToolDeps {
  queryMemory: QueryMemoryClient;
}

export function createQueryMemoryTool(deps: QueryMemoryToolDeps): {
  name: string;
  description: string;
  inputSchema: typeof queryMemoryInputShape;
  handler: (input: unknown, ctx: AuthContext) => Promise<ToolResult>;
} {
  return {
    name: QUERY_MEMORY_TOOL_NAME,
    description: QUERY_MEMORY_DESCRIPTION,
    inputSchema: queryMemoryInputShape,
    handler: async (input, ctx) => {
      const parsed = parseOrThrow(queryMemoryInputSchema, input);
      const args: QueryMemoryArgs = {
        householdId: ctx.householdId as HouseholdId,
        query: parsed.query,
        include_documents: parsed.include_documents,
        include_conflicts: parsed.include_conflicts,
        max_depth: parsed.max_depth,
        limit: parsed.limit,
        ...(parsed.layers !== undefined ? { layers: parsed.layers } : {}),
        ...(parsed.types !== undefined ? { types: parsed.types as NodeType[] } : {}),
        ...(parsed.as_of !== undefined ? { as_of: parsed.as_of } : {}),
        ...(parsed.recency_half_life_days !== undefined
          ? { recency_half_life_days: parsed.recency_half_life_days }
          : {}),
      };
      const result: QueryMemoryResult = await deps.queryMemory.query(args);
      return jsonResult(result);
    },
  };
}
