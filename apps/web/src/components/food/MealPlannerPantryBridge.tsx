/**
 * Planner-side pantry and Instacart bridge.
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type {
  FoodProviderConnectionStatus,
  GroceryListRow,
  MealPlanGroceryItem,
  MealPlanPantrySummary,
} from '@/lib/food';

import { createInstacartDraftFromMealPlanAction, upsertPantryItemAction } from '@/app/actions/food';

interface Props {
  householdId: string;
  weekStartDate: string;
  weekEndDate: string;
  summary: MealPlanPantrySummary;
  draftLists: readonly GroceryListRow[];
  instacart: FoodProviderConnectionStatus;
  canWrite: boolean;
}

interface PantryDraft {
  name: string;
  quantity: string;
  unit: string;
  location: '' | 'fridge' | 'freezer' | 'pantry';
}

const EMPTY_PANTRY_DRAFT: PantryDraft = {
  name: '',
  quantity: '',
  unit: '',
  location: '',
};

function quantityLabel(item: MealPlanGroceryItem): string {
  const qty = item.coverage === 'partial' ? item.shortageQuantity : item.neededQuantity;
  if (qty === null) return item.unit ?? '';
  return `${qty}${item.unit ? ` ${item.unit}` : ''}`;
}

function parseQuantity(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function providerLabel(provider: string | null): string {
  switch (provider) {
    case 'instacart':
      return 'Instacart';
    case 'pantry_diff':
      return 'Pantry diff';
    case 'suggestion_approval':
      return 'Approved proposal';
    case 'stub':
      return 'Export';
    default:
      return provider ?? 'Manual';
  }
}

function DraftListStrip({ lists }: { lists: readonly GroceryListRow[] }) {
  if (lists.length === 0) {
    return <p className="text-xs text-fg-muted">No active grocery drafts yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {lists.slice(0, 3).map((list) => (
        <Link
          key={list.id}
          href="/food/groceries"
          className="rounded-md border border-border bg-bg px-3 py-2 text-xs no-underline hover:border-accent/60"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium text-fg">{providerLabel(list.provider)}</span>
            <span className="text-fg-muted">
              {list.items.length} item{list.items.length === 1 ? '' : 's'}
            </span>
          </span>
          <span className="mt-0.5 block text-fg-muted">
            {list.plannedFor ? `For ${list.plannedFor}` : 'No shopping date'}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function MealPlannerPantryBridge({
  householdId,
  weekStartDate,
  weekEndDate,
  summary,
  draftLists,
  instacart,
  canWrite,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pantryDraft, setPantryDraft] = useState<PantryDraft>(EMPTY_PANTRY_DRAFT);

  function createDraft() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await createInstacartDraftFromMealPlanAction({
        householdId,
        from: weekStartDate,
        to: weekEndDate,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setNotice(
        `${res.data.itemCount} item${res.data.itemCount === 1 ? '' : 's'} staged for ${res.data.plannedFor}.`,
      );
      router.refresh();
    });
  }

  function addPantryItem() {
    if (!pantryDraft.name.trim()) {
      setError('pantry item name is required');
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await upsertPantryItemAction({
        householdId,
        name: pantryDraft.name.trim(),
        quantity: parseQuantity(pantryDraft.quantity),
        unit: pantryDraft.unit.trim() || null,
        expiresOn: null,
        location: pantryDraft.location || null,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setPantryDraft(EMPTY_PANTRY_DRAFT);
      setNotice('Pantry updated.');
      router.refresh();
    });
  }

  const unresolvedCount = summary.unresolvedMeals.length;
  const missingCount = summary.missingItems.length;
  const coveredCount = summary.coveredItems.length;

  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Pantry to Instacart</h2>
          <p className="mt-1 text-xs leading-5 text-fg-muted">
            Current week ingredients minus pantry inventory.
          </p>
        </div>
        <span
          className={
            instacart.active
              ? 'rounded-full bg-accent/15 px-2 py-1 text-[11px] font-medium text-accent'
              : 'rounded-full border border-border px-2 py-1 text-[11px] text-fg-muted'
          }
        >
          {instacart.active ? 'Instacart connected' : 'Instacart not connected'}
        </span>
      </div>

      {error ? (
        <div role="alert" className="rounded-md border border-red-500/60 bg-red-500/5 p-2 text-sm">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-accent/40 bg-accent/5 p-2 text-sm text-fg">
          {notice}{' '}
          <Link href="/food/groceries" className="text-accent underline underline-offset-2">
            Open groceries
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border bg-bg p-2">
          <div className="text-lg font-semibold">{missingCount}</div>
          <div className="text-[11px] uppercase tracking-wide text-fg-muted">to buy</div>
        </div>
        <div className="rounded-lg border border-border bg-bg p-2">
          <div className="text-lg font-semibold">{coveredCount}</div>
          <div className="text-[11px] uppercase tracking-wide text-fg-muted">on hand</div>
        </div>
        <div className="rounded-lg border border-border bg-bg p-2">
          <div className="text-lg font-semibold">{unresolvedCount}</div>
          <div className="text-[11px] uppercase tracking-wide text-fg-muted">unknown</div>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Missing for meals</h3>
          <Link href="/food/pantry" className="text-xs text-fg-muted hover:text-fg">
            pantry
          </Link>
        </div>
        {summary.missingItems.length === 0 ? (
          <p className="rounded-md border border-border bg-bg p-3 text-xs text-fg-muted">
            Pantry covers every resolved ingredient in this week&apos;s plan.
          </p>
        ) : (
          <ul className="max-h-48 overflow-y-auto rounded-md border border-border bg-bg p-2 text-xs">
            {summary.missingItems.slice(0, 12).map((item) => (
              <li key={item.name} className="flex items-baseline justify-between gap-3 py-1">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{item.name}</span>
                  <span className="ml-1 text-fg-muted">
                    {item.coverage === 'partial' ? 'short' : 'missing'}
                  </span>
                </span>
                <span className="shrink-0 text-fg-muted">{quantityLabel(item)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
        onClick={createDraft}
        disabled={!canWrite || pending || summary.missingItems.length === 0}
      >
        {pending ? 'Preparing…' : 'Create Instacart draft'}
      </button>
      {!instacart.active ? (
        <p className="text-xs leading-5 text-fg-muted">
          This will stage an Instacart-labeled list in HomeHub. Connect Instacart in{' '}
          <Link href="/settings/connections" className="text-accent underline underline-offset-2">
            settings
          </Link>{' '}
          when provider credentials are available.
        </p>
      ) : null}

      <section className="flex flex-col gap-2 border-t border-border pt-3">
        <h3 className="text-sm font-medium">Active drafts</h3>
        <DraftListStrip lists={draftLists} />
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-3">
        <h3 className="text-sm font-medium">Quick add to pantry</h3>
        <div className="grid grid-cols-[1fr_72px] gap-2">
          <input
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-fg"
            value={pantryDraft.name}
            onChange={(e) => setPantryDraft((draft) => ({ ...draft, name: e.target.value }))}
            placeholder="Item"
            disabled={!canWrite || pending}
          />
          <input
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-fg"
            value={pantryDraft.quantity}
            onChange={(e) => setPantryDraft((draft) => ({ ...draft, quantity: e.target.value }))}
            placeholder="Qty"
            inputMode="decimal"
            disabled={!canWrite || pending}
          />
          <input
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-fg"
            value={pantryDraft.unit}
            onChange={(e) => setPantryDraft((draft) => ({ ...draft, unit: e.target.value }))}
            placeholder="Unit"
            disabled={!canWrite || pending}
          />
          <select
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-fg"
            value={pantryDraft.location}
            onChange={(e) =>
              setPantryDraft((draft) => ({
                ...draft,
                location: e.target.value as PantryDraft['location'],
              }))
            }
            disabled={!canWrite || pending}
            aria-label="Pantry location"
          >
            <option value="">Any</option>
            <option value="fridge">Fridge</option>
            <option value="freezer">Freezer</option>
            <option value="pantry">Pantry</option>
          </select>
        </div>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg/50 disabled:opacity-60"
          onClick={addPantryItem}
          disabled={!canWrite || pending}
        >
          Add pantry item
        </button>
      </section>
    </aside>
  );
}
