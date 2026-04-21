/**
 * Client island: a small form to create a queue item.
 *
 * Posts through `createQueueItemAction` and refreshes the route on
 * success.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createQueueItemAction } from '@/app/actions/fun';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

export interface CreateQueueItemFormProps {
  householdId: string;
}

const SUBCATEGORIES = ['book', 'show', 'movie', 'game', 'podcast', 'other'] as const;

export function CreateQueueItemForm({ householdId }: CreateQueueItemFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [subcategory, setSubcategory] = useState<(typeof SUBCATEGORIES)[number]>('book');
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    startTransition(async () => {
      const res = await createQueueItemAction({
        householdId,
        title: title.trim(),
        subcategory,
      });
      if (res.ok) {
        toast({ title: 'Added to queue', variant: 'success' });
        setTitle('');
        router.refresh();
      } else {
        toast({
          title: "Couldn't add",
          description: res.error.message,
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
      aria-label="Add to queue"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="queue-title">Title</Label>
        <Input
          id="queue-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. The Anthropologist"
          maxLength={200}
          disabled={isPending}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="queue-subcategory">Kind</Label>
        <select
          id="queue-subcategory"
          value={subcategory}
          onChange={(e) => setSubcategory(e.target.value as (typeof SUBCATEGORIES)[number])}
          className="rounded-sm border border-border bg-bg p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          disabled={isPending}
        >
          {SUBCATEGORIES.map((s) => (
            <option key={s} value={s}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={isPending || !title.trim()}>
        {isPending ? 'Adding…' : 'Add to queue'}
      </Button>
    </form>
  );
}
