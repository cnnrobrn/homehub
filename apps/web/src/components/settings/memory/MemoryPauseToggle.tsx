/**
 * Client island that owns the "pause memory writes" switch.
 *
 * Owner-only — the parent only renders this component when
 * `memberRole === 'owner'`. The switch is disabled while a submission
 * is in flight; errors surface as a toast.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { toggleMemoryWritesAction } from '@/app/actions/memory';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';

export interface MemoryPauseToggleProps {
  initialPaused: boolean;
}

export function MemoryPauseToggle({ initialPaused }: MemoryPauseToggleProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [paused, setPaused] = useState(initialPaused);

  const onChange = (nextValue: boolean) => {
    startTransition(async () => {
      const prev = paused;
      setPaused(nextValue); // optimistic
      const res = await toggleMemoryWritesAction({ paused: nextValue });
      if (!res.ok) {
        setPaused(prev);
        toast({
          variant: 'destructive',
          title: 'Could not update memory writes',
          description: res.error.message,
        });
        return;
      }
      toast({
        variant: 'success',
        title: nextValue ? 'Memory writes paused' : 'Memory writes resumed',
      });
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <Switch
        id="memory-pause-toggle"
        aria-label="Pause memory writes"
        checked={paused}
        onCheckedChange={onChange}
        disabled={pending}
      />
      <label
        htmlFor="memory-pause-toggle"
        className="cursor-pointer select-none text-sm font-medium text-fg"
      >
        {paused ? 'Paused' : 'Active'}
      </label>
    </div>
  );
}
