/**
 * Food summary renderer.
 *
 * Deterministic (no model calls). Renders a weekly / monthly markdown
 * brief covering:
 *   - meal count in the period,
 *   - dish variety (unique dish titles vs total meals),
 *   - pantry items that expired in-period (as a "waste" estimator),
 *   - cooking distribution per member (by cook_member_id).
 *
 * Output shape mirrors the financial brief: `{ bodyMd, metrics }` where
 * metrics is a structured blob the UI / follow-up summaries can consume
 * without re-parsing markdown.
 */

import {
  type FoodSummaryInput,
  type FoodSummaryMetrics,
  type FoodSummaryOutput,
  type MealSummaryRow,
  type PantryItemSummaryRow,
  type SummaryPeriod,
} from './types.js';

export function renderFoodSummary(input: FoodSummaryInput): FoodSummaryOutput {
  const metrics = computeFoodMetrics(input);
  const bodyMd = renderMarkdown(input, metrics);
  return { bodyMd, metrics };
}

export function computeFoodMetrics(input: FoodSummaryInput): FoodSummaryMetrics {
  const meals = input.meals.filter(
    (m) => m.household_id === input.householdId && inWindow(m.planned_for, input),
  );

  const mealCount = meals.length;
  const dishTitles = new Set<string>();
  const cookCounts = new Map<string | null, number>();
  for (const meal of meals) {
    dishTitles.add(meal.dish_node_id ?? meal.title.trim().toLowerCase());
    const key = meal.cook_member_id;
    cookCounts.set(key, (cookCounts.get(key) ?? 0) + 1);
  }
  const dishVariety = dishTitles.size;

  // Pantry waste — items that expired in the window. A positive proxy
  // for "food we threw out."
  const expiredItems = input.pantryItems.filter((p) => {
    if (p.household_id !== input.householdId) return false;
    if (!p.expires_on) return false;
    return inWindow(p.expires_on, input);
  });

  const cookingByMember: FoodSummaryMetrics['cookingByMember'] = [];
  for (const [memberId, count] of cookCounts) {
    cookingByMember.push({
      memberId: memberId,
      memberName: memberId ? (input.memberNamesById.get(memberId) ?? 'Unknown') : 'Unassigned',
      mealCount: count,
    });
  }
  // Deterministic ordering: highest count first, then by memberId.
  cookingByMember.sort((a, b) => {
    if (b.mealCount !== a.mealCount) return b.mealCount - a.mealCount;
    return (a.memberId ?? '').localeCompare(b.memberId ?? '');
  });

  return {
    mealCount,
    dishVariety,
    dishVarietyRatio: mealCount > 0 ? dishVariety / mealCount : 0,
    pantryItemsExpired: expiredItems.length,
    cookingByMember,
  };
}

function inWindow(dateStr: string, input: FoodSummaryInput): boolean {
  const startMs = Date.parse(input.coveredStart);
  const endMs = Date.parse(input.coveredEnd);
  const candidateMs = Date.parse(dateStr.length === 10 ? `${dateStr}T00:00:00.000Z` : dateStr);
  if (!Number.isFinite(candidateMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return false;
  }
  return candidateMs >= startMs && candidateMs < endMs;
}

function renderMarkdown(input: FoodSummaryInput, metrics: FoodSummaryMetrics): string {
  const lines: string[] = [];
  lines.push(`### ${periodHeader(input.period)}`);
  lines.push(`_${formatDate(input.coveredStart)} – ${formatDate(input.coveredEnd)}_`);
  lines.push('');

  if (metrics.mealCount === 0) {
    lines.push('No meals planned in this period.');
    return lines.join('\n');
  }

  lines.push(`**Meals planned:** ${metrics.mealCount}`);
  lines.push(
    `**Dish variety:** ${metrics.dishVariety} unique dish${metrics.dishVariety === 1 ? '' : 'es'} (${Math.round(metrics.dishVarietyRatio * 100)}% ratio)`,
  );
  if (metrics.pantryItemsExpired > 0) {
    lines.push(
      `**Pantry items expired:** ${metrics.pantryItemsExpired} — consider tightening meal planning around upcoming expiry dates.`,
    );
  }
  lines.push('');

  if (metrics.cookingByMember.length > 0) {
    lines.push('**Cooking distribution:**');
    for (const row of metrics.cookingByMember) {
      lines.push(`- ${row.memberName}: ${row.mealCount} meal${row.mealCount === 1 ? '' : 's'}`);
    }
  }
  return lines.join('\n').trimEnd();
}

function periodHeader(period: SummaryPeriod): string {
  if (period === 'weekly') return 'Weekly food brief';
  if (period === 'monthly') return 'Monthly food brief';
  return 'Daily food brief';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Re-export shared types so callers can import everything from
// `@homehub/summaries`.
export type {
  FoodSummaryInput,
  FoodSummaryMetrics,
  FoodSummaryOutput,
  MealSummaryRow,
  PantryItemSummaryRow,
};
