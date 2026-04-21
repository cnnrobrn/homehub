/**
 * `@homehub/tools` — foreground-agent tool catalog.
 *
 * Public surface:
 *   - Types: ToolDefinition, ToolContext, ToolClass, OpenAiToolSpec,
 *            ToolCallResult, ToolError (+ subclasses).
 *   - Factory: `createToolCatalog(ctx)` returns the M3.5-A default
 *     set; `createToolCatalogFromDefinitions(ctx, defs)` is the
 *     test / MCP convergence hook.
 *   - Introspection: `classifyTools`, `readableSegments`.
 *   - Individual tool definitions (re-exported so the MCP server can
 *     migrate tool by tool).
 */

import { createToolCatalogFromDefinitions, type ToolCatalog } from './catalog.js';
import { defaultToolSet } from './defaultSet.js';

import type { ToolContext } from './types.js';

export { TOOL_CLASSES, TOOL_SEGMENTS } from './types.js';
export {
  ToolError,
  ToolForbiddenError,
  ToolNotFoundError,
  ToolNotImplementedError,
  ToolValidationError,
} from './types.js';
export type {
  MemberRole,
  OpenAiToolSpec,
  ToolCallFailure,
  ToolCallResult,
  ToolCallSuccess,
  ToolClass,
  ToolContext,
  ToolDefinition,
  ToolGrant,
  ToolSegment,
  ToolSegmentScope,
} from './types.js';

export {
  createToolCatalogFromDefinitions,
  classifyTools,
  readableSegments,
  type ToolCatalog,
  type CreateCatalogOptions,
} from './catalog.js';

export { defaultToolSet } from './defaultSet.js';

export { queryMemoryTool } from './tools/queryMemory.js';
export { listEventsTool } from './tools/listEvents.js';
export { listTransactionsTool } from './tools/listTransactions.js';
export { listMealsTool } from './tools/listMeals.js';
export { getPantryTool } from './tools/getPantry.js';
export { getGroceryListTool } from './tools/getGroceryList.js';
export { getAccountBalancesTool } from './tools/getAccountBalances.js';
export { getBudgetStatusTool } from './tools/getBudgetStatus.js';
export { listSuggestionsTool } from './tools/listSuggestions.js';
export { getHouseholdMembersTool } from './tools/getHouseholdMembers.js';
export { getNodeTool } from './tools/getNode.js';
export { getEpisodeTimelineTool } from './tools/getEpisodeTimeline.js';
export { rememberFactTool } from './tools/rememberFact.js';
export { createRuleTool } from './tools/createRule.js';
export {
  draftWriteStubs,
  addMealToPlanStub,
  draftMealPlanStub,
  proposeGroceryOrderStub,
  proposeTransferStub,
  draftMessageStub,
  proposeAddToCalendarStub,
  supersedeFactStub,
  forgetFactStub,
} from './tools/draftWriteStubs.js';

/**
 * Build the M3.5-A catalog bound to a caller's `ToolContext`.
 */
export function createToolCatalog(ctx: ToolContext): ToolCatalog {
  return createToolCatalogFromDefinitions(ctx, defaultToolSet());
}
