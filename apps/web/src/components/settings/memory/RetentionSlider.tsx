/**
 * Client slider + input pair for a single retention category.
 *
 * Commits on blur / slider commit (not every drag tick) so we don't
 * spam the server. The number input mirrors the slider for keyboard
 * accessibility and exact entry.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { RetentionCategory } from './RetentionWindowsCard';

import { updateRetentionWindowsAction } from '@/app/actions/memory';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/components/ui/use-toast';

const MIN_DAYS = 7;
const MAX_DAYS = 3_650;

export interface RetentionSliderProps {
  category: RetentionCategory;
  label: string;
  initialDays: number;
  disabled: boolean;
}

export function RetentionSlider({ category, label, initialDays, disabled }: RetentionSliderProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState(initialDays);
  const [committed, setCommitted] = useState(initialDays);

  const commit = (next: number) => {
    const clamped = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(next)));
    if (clamped === committed) return;
    startTransition(async () => {
      const prev = committed;
      setCommitted(clamped);
      const res = await updateRetentionWindowsAction({ category, days: clamped });
      if (!res.ok) {
        setCommitted(prev);
        setDays(prev);
        toast({
          variant: 'destructive',
          title: `Could not update ${label} retention`,
          description: res.error.message,
        });
        return;
      }
      toast({ variant: 'success', title: `${label} set to ${clamped} days` });
      router.refresh();
    });
  };

  const sliderId = `retention-${category}`;
  const inputId = `retention-input-${category}`;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <label htmlFor={sliderId} className="sr-only">
        {label} retention in days
      </label>
      <Slider
        id={sliderId}
        className="w-full sm:flex-1"
        min={MIN_DAYS}
        max={MAX_DAYS}
        step={1}
        value={[days]}
        onValueChange={(v) => setDays(v[0] ?? days)}
        onValueCommit={(v) => commit(v[0] ?? days)}
        disabled={disabled || pending}
        aria-label={`${label} retention in days`}
      />
      <div className="flex items-center gap-2 sm:w-36">
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={MIN_DAYS}
          max={MAX_DAYS}
          value={days}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isFinite(v)) setDays(v);
          }}
          onBlur={(e) => commit(Number(e.currentTarget.value))}
          disabled={disabled || pending}
          aria-label={`${label} retention in days`}
          className="w-24"
        />
        <span className="text-xs text-fg-muted">days</span>
      </div>
    </div>
  );
}
