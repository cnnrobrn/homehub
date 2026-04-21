/**
 * `defaultToolSet()` — the production catalog that ships with M3.5-A.
 *
 * Call sites:
 *   - `apps/workers/foreground-agent` — constructs one per turn.
 *   - (Future) `apps/mcp/homehub-core` — converge when the MCP server
 *     moves from its own per-tool handlers to the shared catalog.
 *
 * Ordering: read tools first (query_memory lead so the model picks it
 * for factual questions), then read state tools, then direct-writes,
 * then draft-writes.
 */

import { createRuleTool } from './tools/createRule.js';
import { draftWriteStubs } from './tools/draftWriteStubs.js';
import { getAccountBalancesTool } from './tools/getAccountBalances.js';
import { getBudgetStatusTool } from './tools/getBudgetStatus.js';
import { getEpisodeTimelineTool } from './tools/getEpisodeTimeline.js';
import { getGroceryListTool } from './tools/getGroceryList.js';
import { getHouseholdMembersTool } from './tools/getHouseholdMembers.js';
import { getNodeTool } from './tools/getNode.js';
import { getPantryTool } from './tools/getPantry.js';
import { listEventsTool } from './tools/listEvents.js';
import { listMealsTool } from './tools/listMeals.js';
import { listSuggestionsTool } from './tools/listSuggestions.js';
import { listTransactionsTool } from './tools/listTransactions.js';
import { queryMemoryTool } from './tools/queryMemory.js';
import { rememberFactTool } from './tools/rememberFact.js';

import type { ToolDefinition } from './types.js';

export function defaultToolSet(): ReadonlyArray<ToolDefinition<unknown, unknown>> {
  return [
    // Reads — memory
    queryMemoryTool as ToolDefinition<unknown, unknown>,
    getNodeTool as ToolDefinition<unknown, unknown>,
    getEpisodeTimelineTool as ToolDefinition<unknown, unknown>,
    // Reads — household state
    listEventsTool as ToolDefinition<unknown, unknown>,
    listTransactionsTool as ToolDefinition<unknown, unknown>,
    listMealsTool as ToolDefinition<unknown, unknown>,
    getPantryTool as ToolDefinition<unknown, unknown>,
    getGroceryListTool as ToolDefinition<unknown, unknown>,
    getAccountBalancesTool as ToolDefinition<unknown, unknown>,
    getBudgetStatusTool as ToolDefinition<unknown, unknown>,
    listSuggestionsTool as ToolDefinition<unknown, unknown>,
    getHouseholdMembersTool as ToolDefinition<unknown, unknown>,
    // Direct-writes
    rememberFactTool as ToolDefinition<unknown, unknown>,
    createRuleTool as ToolDefinition<unknown, unknown>,
    // Draft-write stubs (suggestion-card surface for the UI)
    ...(draftWriteStubs as ReadonlyArray<ToolDefinition<unknown, unknown>>),
  ];
}
