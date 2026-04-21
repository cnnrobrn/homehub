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
export { draftWriteStubs, supersedeFactStub, forgetFactStub } from './tools/draftWriteStubs.js';

// M9-C draft-write tools with real suggestion persistence.
export { proposeTransferTool } from './tools/proposeTransfer.js';
export { proposeCancelSubscriptionTool } from './tools/proposeCancelSubscription.js';
export { draftMessageTool } from './tools/draftMessage.js';
export { proposeAddToCalendarTool } from './tools/proposeAddToCalendar.js';
export { proposeBookReservationTool } from './tools/proposeBookReservation.js';
export { settleSharedExpenseTool } from './tools/settleSharedExpense.js';

// Food-segment tools (M6).
export { addMealToPlanTool } from './tools/food/addMealToPlan.js';
export { updateMealTool } from './tools/food/updateMeal.js';
export { removeMealTool } from './tools/food/removeMeal.js';
export { addPantryItemTool } from './tools/food/addPantryItem.js';
export { updatePantryItemTool } from './tools/food/updatePantryItem.js';
export { removePantryItemTool } from './tools/food/removePantryItem.js';
export { draftMealPlanTool } from './tools/food/draftMealPlan.js';
export { proposeGroceryOrderTool } from './tools/food/proposeGroceryOrder.js';

/**
 * Build the M3.5-A catalog bound to a caller's `ToolContext`.
 */
export function createToolCatalog(ctx: ToolContext): ToolCatalog {
  return createToolCatalogFromDefinitions(ctx, defaultToolSet());
}
