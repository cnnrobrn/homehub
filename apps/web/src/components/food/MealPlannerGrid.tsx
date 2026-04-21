/**
 * Weekly meal planner grid.
 *
 * Uses `@dnd-kit/core` + `@dnd-kit/sortable` so drag-drop is keyboard
 * accessible out of the box. Drag handles are native `<button>` with
 * aria labels; Space/Enter picks up, arrow keys move, Space drops.
 *
 * The grid shows 7 days × 4 slots. Cells render the meal's title + a
 * delete button. A "+" pill per empty cell opens the inline add form.
 *
 * Writes go through `upsertMealAction` / `deleteMealAction`.
 */

'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import type { MealRow } from '@/lib/food/listMeals';

import { deleteMealAction, upsertMealAction } from '@/app/actions/food';
import { cn } from '@/lib/cn';
import { MEAL_SLOTS, type MealSlot } from '@/lib/food/types';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

function cellId(date: string, slot: MealSlot): string {
  return `${date}:${slot}`;
}

function formatDayHeader(date: string): { weekday: string; short: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    short: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

function* eachDay(startIso: string, count: number): Generator<string> {
  const start = new Date(`${startIso}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    yield d.toISOString().slice(0, 10);
  }
}

export interface MealPlannerGridProps {
  householdId: string;
  weekStartDate: string;
  initial: readonly MealRow[];
  canWrite: boolean;
}

interface MealCard {
  meal: MealRow;
}

function SortableMealCard({
  meal,
  onDelete,
  canWrite,
}: {
  meal: MealRow;
  onDelete: () => void;
  canWrite: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: meal.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex flex-col gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs',
        isDragging ? 'opacity-50' : '',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          className="flex-1 cursor-grab text-left font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          {...attributes}
          {...listeners}
          aria-label={`Meal: ${meal.title}. Drag to move.`}
          disabled={!canWrite}
        >
          {meal.title}
        </button>
        {canWrite ? (
          <button
            type="button"
            aria-label={`Delete ${meal.title}`}
            className="rounded-sm border border-border px-1 text-fg-muted opacity-0 transition-opacity hover:bg-bg/50 focus-visible:opacity-100 group-hover:opacity-100"
            onClick={onDelete}
          >
            ×
          </button>
        ) : null}
      </div>
      {meal.status !== 'planned' ? (
        <span className="text-[10px] uppercase tracking-wide text-fg-muted">{meal.status}</span>
      ) : null}
    </div>
  );
}

function EmptyCellAdd({
  date,
  slot,
  canWrite,
  onAdd,
  pending,
}: {
  date: string;
  slot: MealSlot;
  canWrite: boolean;
  onAdd: (title: string) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (!canWrite) return null;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full rounded-md border border-dashed border-border py-1 text-xs text-fg-muted hover:bg-bg/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`Add ${slot} on ${date}`}
      >
        +
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        onAdd(draft.trim());
        setDraft('');
        setEditing(false);
      }}
      className="flex gap-1"
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        className="w-full rounded border border-border bg-bg px-1 py-1 text-xs text-fg"
        placeholder="Dish"
        disabled={pending}
      />
    </form>
  );
}

export function MealPlannerGrid({
  householdId,
  weekStartDate,
  initial,
  canWrite,
}: MealPlannerGridProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const days = useMemo(() => [...eachDay(weekStartDate, 7)], [weekStartDate]);
  const byCell = useMemo(() => {
    const map = new Map<string, MealCard[]>();
    for (const meal of initial) {
      const key = cellId(meal.plannedFor.slice(0, 10), meal.slot);
      const bucket = map.get(key) ?? [];
      bucket.push({ meal });
      map.set(key, bucket);
    }
    return map;
  }, [initial]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !canWrite) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const targetMeal = initial.find((m) => m.id === activeId);
    if (!targetMeal) return;

    // Drop target is a cell id `date:slot` (we encode cells as
    // droppables). Move the meal by updating planned_for + slot.
    const [newDate, newSlot] = overId.includes(':') ? overId.split(':') : [null, null];
    if (!newDate || !newSlot) return;

    startTransition(async () => {
      const res = await upsertMealAction({
        householdId,
        mealId: targetMeal.id,
        date: newDate,
        slot: newSlot as MealSlot,
        title: targetMeal.title,
        ...(targetMeal.dishNodeId ? { dishNodeId: targetMeal.dishNodeId } : {}),
        ...(targetMeal.cookMemberId ? { cookMemberId: targetMeal.cookMemberId } : {}),
        ...(targetMeal.servings ? { servings: targetMeal.servings } : {}),
        status: targetMeal.status,
        ...(targetMeal.notes ? { notes: targetMeal.notes } : {}),
      });
      if (!res.ok) setError(res.error.message);
      else router.refresh();
    });
  }

  function handleAdd(date: string, slot: MealSlot, title: string) {
    startTransition(async () => {
      const res = await upsertMealAction({
        householdId,
        date,
        slot,
        title,
      });
      if (!res.ok) setError(res.error.message);
      else router.refresh();
    });
  }

  function handleDelete(mealId: string) {
    startTransition(async () => {
      const res = await deleteMealAction({ householdId, mealId });
      if (!res.ok) setError(res.error.message);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div role="alert" className="rounded-md border border-red-500/60 bg-red-500/5 p-2 text-sm">
          {error}
        </div>
      ) : null}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-24 p-2 text-left text-xs uppercase text-fg-muted">Slot</th>
                {days.map((date) => {
                  const hdr = formatDayHeader(date);
                  return (
                    <th key={date} className="p-2 text-left text-xs text-fg">
                      <div className="flex flex-col">
                        <span className="uppercase text-fg-muted">{hdr.weekday}</span>
                        <span>{hdr.short}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {MEAL_SLOTS.map((slot) => (
                <tr key={slot} className="border-b border-border/60 align-top">
                  <th className="p-2 text-left text-xs uppercase text-fg-muted">
                    {SLOT_LABELS[slot]}
                  </th>
                  {days.map((date) => {
                    const cellKey = cellId(date, slot);
                    const items = byCell.get(cellKey) ?? [];
                    return (
                      <td
                        key={cellKey}
                        id={cellKey}
                        className="align-top p-2"
                        aria-label={`${SLOT_LABELS[slot]} on ${date}`}
                      >
                        <SortableContext
                          items={items.map((i) => i.meal.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="flex flex-col gap-1">
                            {items.map(({ meal }) => (
                              <SortableMealCard
                                key={meal.id}
                                meal={meal}
                                onDelete={() => handleDelete(meal.id)}
                                canWrite={canWrite}
                              />
                            ))}
                            <EmptyCellAdd
                              date={date}
                              slot={slot}
                              canWrite={canWrite}
                              onAdd={(title) => handleAdd(date, slot, title)}
                              pending={pending}
                            />
                          </div>
                        </SortableContext>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DndContext>
    </div>
  );
}
