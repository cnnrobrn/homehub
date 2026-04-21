/**
 * `GroceryListsView` — renders past / current grocery lists plus the
 * pending `propose_grocery_order` suggestion approval surface.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useTransition, useState } from 'react';


import type { FoodSuggestionRow } from '@/lib/food/listFoodSuggestions';
import type { GroceryListRow } from '@/lib/food/listGroceryLists';

import { approveGroceryDraftAction, rejectGroceryDraftAction } from '@/app/actions/food';

export interface GroceryListsViewProps {
  lists: readonly GroceryListRow[];
  pendingSuggestions: readonly FoodSuggestionRow[];
}

function statusLabel(status: GroceryListRow['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'ordered':
      return 'Ordered';
    case 'received':
      return 'Received';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

export function GroceryListsView({ lists, pendingSuggestions }: GroceryListsViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleApprove(suggestionId: string) {
    startTransition(async () => {
      const res = await approveGroceryDraftAction({ suggestionId });
      if (!res.ok) setError(res.error.message);
      else router.refresh();
    });
  }

  function handleReject(suggestionId: string) {
    startTransition(async () => {
      const res = await rejectGroceryDraftAction({ suggestionId });
      if (!res.ok) setError(res.error.message);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <div role="alert" className="rounded-md border border-red-500/60 bg-red-500/5 p-2 text-sm">
          {error}
        </div>
      ) : null}

      <section aria-labelledby="pending-heading" className="flex flex-col gap-2">
        <h2 id="pending-heading" className="text-lg font-medium">
          Pending proposals
        </h2>
        {pendingSuggestions.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            No pending proposals.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingSuggestions.map((suggestion) => {
              const preview = suggestion.preview as {
                planned_for?: string;
                items?: Array<{ name?: string; quantity?: number; unit?: string }>;
              };
              const items = Array.isArray(preview.items) ? preview.items : [];
              return (
                <li
                  key={suggestion.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-fg">{suggestion.title}</span>
                    <span className="text-xs text-fg-muted">
                      {new Date(suggestion.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-fg-muted">{suggestion.rationale}</p>
                  {items.length > 0 ? (
                    <ul className="max-h-48 overflow-y-auto rounded-md border border-border bg-bg p-2 text-xs text-fg-muted">
                      {items.map((item, idx) => (
                        <li key={idx}>
                          {item.name ?? 'Unnamed'} {item.quantity ?? ''} {item.unit ?? ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
                      onClick={() => handleApprove(suggestion.id)}
                      disabled={pending}
                    >
                      Approve draft
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg/50 disabled:opacity-60"
                      onClick={() => handleReject(suggestion.id)}
                      disabled={pending}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="lists-heading" className="flex flex-col gap-2">
        <h2 id="lists-heading" className="text-lg font-medium">
          Recent lists
        </h2>
        {lists.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            No grocery lists yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.map((list) => (
              <li
                key={list.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg">
                    {list.plannedFor
                      ? `For ${new Date(list.plannedFor).toLocaleDateString()}`
                      : 'Undated'}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-fg-muted">
                    {statusLabel(list.status)} · {list.items.length} item
                    {list.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                {list.items.length > 0 ? (
                  <ul className="mt-2 grid grid-cols-1 gap-y-1 text-xs text-fg-muted sm:grid-cols-2">
                    {list.items.map((item) => (
                      <li key={item.id} className="flex items-baseline gap-1">
                        <span className={item.checked ? 'line-through opacity-60' : ''}>
                          {item.name}
                        </span>
                        {item.quantity ? (
                          <span className="text-fg-muted">
                            · {item.quantity} {item.unit ?? ''}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
