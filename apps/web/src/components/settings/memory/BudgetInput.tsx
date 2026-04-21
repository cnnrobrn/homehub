/**
 * Client island for the model-budget input.
 *
 * Users enter dollars; we convert to cents before sending to the
 * server action. Non-numeric / out-of-range input is rejected client
 * side with inline feedback.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { updateModelBudgetAction } from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

export interface BudgetInputProps {
  initialCents: number;
  disabled: boolean;
}

const MAX_USD = 10_000; // 1_000_000 cents.

export function BudgetInput({ initialCents, disabled }: BudgetInputProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dollars, setDollars] = useState((initialCents / 100).toFixed(2));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    setError(null);
    const parsed = Number(dollars);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_USD) {
      setError(`must be a number between 0 and ${MAX_USD}`);
      return;
    }
    const cents = Math.round(parsed * 100);
    if (cents === initialCents) return;
    startTransition(async () => {
      const res = await updateModelBudgetAction({ cents });
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not update budget',
          description: res.error.message,
        });
        return;
      }
      toast({ variant: 'success', title: 'Budget updated' });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
      <div className="flex w-full flex-col gap-1 sm:w-48">
        <Label htmlFor="model-budget-input">Monthly budget (USD)</Label>
        <Input
          id="model-budget-input"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          max={MAX_USD}
          value={dollars}
          onChange={(e) => setDollars(e.currentTarget.value)}
          disabled={disabled || pending}
          aria-invalid={error ? 'true' : 'false'}
        />
        {error ? (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        ) : null}
      </div>
      <Button type="button" onClick={commit} disabled={disabled || pending}>
        {pending ? 'Saving…' : 'Save budget'}
      </Button>
    </div>
  );
}
