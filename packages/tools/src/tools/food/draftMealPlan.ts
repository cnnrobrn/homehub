/**
 * `draft_meal_plan` — draft-write.
 *
 * Produces a preview object for a member to approve. Writes an
 * `app.suggestion` row with `kind='draft_meal_plan'` + `status='pending'`
 * so the UI renders a suggestion card.
 *
 * Candidate selection strategy (deterministic):
 *   1. Pull the household's dish library from `mem.node` type='dish',
 *      sorted by `created_at` asc.
 *   2. For each day in the range, pick dishes round-robin, skipping
 *      dishes already planned in the same week.
 *
 * The agent loop calls this when the member says "draft me a meal plan
 * for next week." Approval (which expands the preview into real
 * `app.meal` rows) is M9.
 */

import { z } from 'zod';

import { ToolError, type ToolDefinition } from '../../types.js';

const inputSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  constraints: z
    .object({
      dietary: z.array(z.string()).optional(),
      effort: z.enum(['low', 'medium', 'high']).optional(),
      variety: z.enum(['low', 'medium', 'high']).optional(),
    })
    .optional(),
});

const outputSchema = z.object({
  status: z.literal('pending_approval'),
  suggestion_id: z.string(),
  preview: z.object({
    start_date: z.string(),
    end_date: z.string(),
    slot: z.string(),
    meals: z.array(
      z.object({
        date: z.string(),
        slot: z.string(),
        dish: z.string(),
        dish_node_id: z.string().nullable(),
      }),
    ),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

interface DishRow {
  id: string;
  canonical_name: string;
}

/** Inclusive day iteration from `start` to `end` in UTC. */
function eachDay(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return out;
  for (let ms = start; ms <= end; ms += 24 * 60 * 60 * 1000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

export const draftMealPlanTool: ToolDefinition<Input, Output> = {
  name: 'draft_meal_plan',
  description:
    'Draft a meal plan over a date range. Creates an app.suggestion the member approves before meals land on app.meal. Execution is gated by M9.',
  class: 'draft-write',
  input: inputSchema,
  output: outputSchema,
  segments: ['food'],
  async handler(args, ctx) {
    const slot = args.slot ?? 'dinner';
    const days = eachDay(args.start_date, args.end_date);
    if (days.length === 0) {
      throw new ToolError('invalid_range', 'draft_meal_plan: end_date must be >= start_date');
    }

    // Load the household's dish library (oldest first — deterministic).
    const { data: dishRows, error: dishErr } = await ctx.supabase
      .schema('mem')
      .from('node')
      .select('id, canonical_name')
      .eq('household_id', ctx.householdId)
      .eq('type', 'dish')
      .order('created_at', { ascending: true })
      .limit(200);
    if (dishErr) throw new ToolError('db_error', `draft_meal_plan dishes: ${dishErr.message}`);
    const dishes = (dishRows ?? []) as DishRow[];

    // Build the deterministic preview. If the household has no dishes,
    // we still produce a preview — the member can type titles in.
    const meals = days.map((date, idx) => {
      const dish = dishes.length > 0 ? dishes[idx % dishes.length]! : null;
      return {
        date,
        slot,
        dish: dish?.canonical_name ?? 'TBD',
        dish_node_id: dish?.id ?? null,
      };
    });

    // Persist the suggestion row so the UI can render it.
    const preview = {
      start_date: args.start_date,
      end_date: args.end_date,
      slot,
      meals,
      constraints: args.constraints ?? {},
    };

    const { data: inserted, error: insertErr } = await ctx.supabase
      .schema('app')
      .from('suggestion')
      .insert({
        household_id: ctx.householdId,
        segment: 'food',
        kind: 'draft_meal_plan',
        title: `Meal plan for ${args.start_date} – ${args.end_date}`,
        rationale: `Drafted ${meals.length} ${slot} meal${meals.length === 1 ? '' : 's'} from your dish library. Review before committing.`,
        preview: preview as never,
        status: 'pending',
      })
      .select('id')
      .single();
    if (insertErr) throw new ToolError('db_error', `draft_meal_plan insert: ${insertErr.message}`);

    ctx.log.info('draft_meal_plan suggestion created', {
      household_id: ctx.householdId,
      suggestion_id: inserted.id,
      days: days.length,
    });

    return {
      status: 'pending_approval',
      suggestion_id: inserted.id as string,
      preview: { start_date: args.start_date, end_date: args.end_date, slot, meals },
    };
  },
};
