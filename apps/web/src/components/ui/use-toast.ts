/**
 * Simple toast store + hook.
 *
 * A small event-bus + state singleton — smaller than importing shadcn's
 * reducer-based hook, and enough for our use cases (informational,
 * destructive, success). The `<Toaster />` component reads the queue and
 * renders each entry through the Radix primitives.
 */

'use client';

import * as React from 'react';

type ToastKind = 'default' | 'destructive' | 'success';

export interface ToastInput {
  title?: string;
  description?: string;
  variant?: ToastKind;
  /** Milliseconds before auto-dismiss. Radix default is 5000. */
  duration?: number;
}

export interface ToastItem extends Required<Pick<ToastInput, 'variant'>> {
  id: number;
  title?: string;
  description?: string;
  duration?: number;
}

type Listener = (items: ToastItem[]) => void;

const listeners = new Set<Listener>();
let items: ToastItem[] = [];
let id = 0;

function emit() {
  for (const l of listeners) l(items);
}

export function toast(input: ToastInput): void {
  const item: ToastItem = {
    id: ++id,
    variant: input.variant ?? 'default',
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.duration !== undefined ? { duration: input.duration } : {}),
  };
  items = [...items, item];
  emit();
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): ToastItem[] {
  const [state, setState] = React.useState(items);
  React.useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
