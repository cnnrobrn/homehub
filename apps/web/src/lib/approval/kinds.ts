/**
 * Auto-approval kind options exposed to the settings UI.
 *
 * Lives in a regular module (not a 'use server' file) so React
 * Components and Client Components can import the constant without
 * tripping Next.js's "only async functions can be exported from
 * server actions" check.
 *
 * The deny list in `@homehub/approval-flow` enforces the destructive-
 * kind filter at the state machine too; we mirror it here so the UI
 * never even offers destructive kinds as options.
 */

export const AUTO_APPROVE_KIND_OPTIONS = [
  'add_to_calendar',
  'outing_idea',
  'meal_swap',
  'grocery_order',
  'new_dish',
  'reach_out',
  'gift_idea',
  'host_back',
  'draft_message',
  'propose_add_to_calendar',
  'draft_meal_plan',
  'propose_grocery_order',
] as const;

export type AutoApproveKindOption = (typeof AUTO_APPROVE_KIND_OPTIONS)[number];
