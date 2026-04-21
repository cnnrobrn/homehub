/**
 * Client-side pantry table with inline add / update / delete.
 *
 * Actions call the food server actions via `useTransition` + the shared
 * `ActionResult` envelope. Keyboard-navigable: every row action is a
 * real `<button>`, the add-row is a native `<form>`.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { PantryItemRow } from '@/lib/food/listPantryItems';

import { deletePantryItemAction, upsertPantryItemAction } from '@/app/actions/food';
import { cn } from '@/lib/cn';

export interface PantryTableProps {
  householdId: string;
  initial: readonly PantryItemRow[];
  canWrite: boolean;
}

interface Draft {
  name: string;
  quantity: string;
  unit: string;
  expiresOn: string;
  location: '' | 'fridge' | 'freezer' | 'pantry';
}

const EMPTY_DRAFT: Draft = {
  name: '',
  quantity: '',
  unit: '',
  expiresOn: '',
  location: '',
};

function parseQuantity(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function PantryTable({ householdId, initial, canWrite }: PantryTableProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    if (!draft.name.trim()) {
      setError('name is required');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await upsertPantryItemAction({
        householdId,
        name: draft.name.trim(),
        quantity: parseQuantity(draft.quantity),
        unit: draft.unit.trim() || null,
        expiresOn: draft.expiresOn || null,
        location: draft.location || null,
      });
      if (res.ok) {
        setDraft(EMPTY_DRAFT);
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deletePantryItemAction({ householdId, pantryItemId: id });
      if (!res.ok) setError(res.error.message);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">Item</span>
            <input
              className="w-40 rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              disabled={pending}
              aria-label="Pantry item name"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">Qty</span>
            <input
              className="w-20 rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
              value={draft.quantity}
              onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
              disabled={pending}
              inputMode="decimal"
              aria-label="Quantity"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">Unit</span>
            <input
              className="w-24 rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
              value={draft.unit}
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
              disabled={pending}
              aria-label="Unit"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">Expires</span>
            <input
              type="date"
              className="rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
              value={draft.expiresOn}
              onChange={(e) => setDraft((d) => ({ ...d, expiresOn: e.target.value }))}
              disabled={pending}
              aria-label="Expires on"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">Location</span>
            <select
              className="rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
              value={draft.location}
              onChange={(e) =>
                setDraft((d) => ({ ...d, location: e.target.value as Draft['location'] }))
              }
              disabled={pending}
              aria-label="Location"
            >
              <option value="">—</option>
              <option value="fridge">Fridge</option>
              <option value="freezer">Freezer</option>
              <option value="pantry">Pantry</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
            onClick={handleAdd}
            disabled={pending}
          >
            {pending ? 'Saving…' : 'Add item'}
          </button>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-md border border-red-500/60 bg-red-500/5 p-2 text-sm">
          {error}
        </div>
      ) : null}
      {initial.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
          Pantry is empty.
        </div>
      ) : (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-fg-muted">
              <th className="p-2">Item</th>
              <th className="p-2">Qty</th>
              <th className="p-2">Expires</th>
              <th className="p-2">Location</th>
              <th className="p-2 sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="p-2 font-medium text-fg">{item.name}</td>
                <td className="p-2 text-fg-muted">
                  {item.quantity ?? '—'} {item.unit ?? ''}
                </td>
                <td
                  className={cn(
                    'p-2',
                    item.expiresOn &&
                      new Date(item.expiresOn).getTime() < Date.now() + 3 * 24 * 60 * 60 * 1000
                      ? 'text-amber-500'
                      : 'text-fg-muted',
                  )}
                >
                  {item.expiresOn ?? '—'}
                </td>
                <td className="p-2 text-fg-muted">{item.location ?? '—'}</td>
                <td className="p-2 text-right">
                  {canWrite ? (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-bg/50 disabled:opacity-60"
                      onClick={() => handleDelete(item.id)}
                      disabled={pending}
                      aria-label={`Delete ${item.name}`}
                    >
                      Delete
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
