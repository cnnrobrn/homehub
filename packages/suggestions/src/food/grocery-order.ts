/**
 * `grocery_order` suggestion generator.
 *
 * Produces a `propose_grocery_order` suggestion whenever the
 * pantry-diff worker has produced a deficit list for the next shopping
 * target (default: the upcoming Saturday). The generator itself is
 * stateless; the caller passes the deficit set.
 *
 * Dedupe key: `grocery_order:${plannedFor}` so a single shopping date
 * gets one standing suggestion.
 */

import { type RationaleWriter, type SuggestionEmission } from '../types.js';

import { type PantryDeficit } from './types.js';

export interface GroceryOrderInput {
  householdId: string;
  /** Target shopping date, ISO (YYYY-MM-DD). */
  plannedFor: string;
  deficits: PantryDeficit[];
}

export interface GenerateGroceryOrderArgs extends GroceryOrderInput {
  rationaleWriter?: RationaleWriter;
}

export async function generateGroceryOrderSuggestions(
  args: GenerateGroceryOrderArgs,
): Promise<SuggestionEmission[]> {
  if (args.deficits.length === 0) return [];

  const itemWords = args.deficits
    .slice(0, 3)
    .map((d) => d.name)
    .join(', ');
  const plus = args.deficits.length > 3 ? ` + ${args.deficits.length - 3} more` : '';

  const fallback = `Your planned meals for this week need ${itemWords}${plus}. Draft a grocery order now so you're not missing essentials on shopping day.`;

  const rationale = args.rationaleWriter
    ? await args.rationaleWriter({
        kind: 'grocery_order',
        candidate: {
          planned_for: args.plannedFor,
          deficit_count: args.deficits.length,
          top_items: args.deficits.slice(0, 5).map((d) => d.name),
        },
        fallback,
      })
    : fallback;

  return [
    {
      segment: 'food',
      kind: 'propose_grocery_order',
      title: `Draft a grocery order for ${args.plannedFor} (${args.deficits.length} item${args.deficits.length === 1 ? '' : 's'})`,
      rationale,
      preview: {
        planned_for: args.plannedFor,
        items: args.deficits.map((d) => ({
          name: d.name,
          quantity: d.quantity,
          unit: d.unit,
          source_meal_ids: d.sourceMealIds,
        })),
        dedupe_key: `grocery_order:${args.plannedFor}`,
      },
      dedupeKey: `grocery_order:${args.plannedFor}`,
    },
  ];
}
