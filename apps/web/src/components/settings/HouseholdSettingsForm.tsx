/**
 * Owner-only edit form for household name + settings.
 *
 * Includes the Delete-household danger zone (stub — real flow lands
 * in M10 per the dispatch).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { updateHouseholdAction } from '@/app/actions/household';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';

const schema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().max(64).optional().or(z.literal('')),
  currency: z.string().length(3).optional().or(z.literal('')),
  weekStart: z.enum(['sunday', 'monday']),
});

type Values = z.infer<typeof schema>;

interface Props {
  householdId: string;
  initial: {
    name: string;
    timezone: string;
    currency: string;
    weekStart: 'sunday' | 'monday';
  };
}

export function HouseholdSettingsForm({ householdId, initial }: Props) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });

  const weekStart = watch('weekStart');

  async function onSubmit(values: Values) {
    const res = await updateHouseholdAction({
      householdId,
      name: values.name,
      ...(values.timezone ? { timezone: values.timezone } : {}),
      ...(values.currency ? { currency: values.currency } : {}),
      weekStart: values.weekStart,
    });
    if (!res.ok) {
      toast({
        variant: 'destructive',
        title: 'Could not save',
        description: res.error.message,
      });
      return;
    }
    toast({ variant: 'success', title: 'Household updated' });
    reset(values);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="h-name">Name</Label>
        <Input id="h-name" aria-invalid={errors.name ? 'true' : 'false'} {...register('name')} />
        <FormMessage error={errors.name?.message ?? null} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="h-tz">Timezone</Label>
          <Input id="h-tz" placeholder="America/New_York" {...register('timezone')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="h-currency">Currency</Label>
          <Input
            id="h-currency"
            placeholder="USD"
            maxLength={3}
            aria-invalid={errors.currency ? 'true' : 'false'}
            {...register('currency')}
          />
          <FormMessage error={errors.currency?.message ?? null} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="h-week-start">Week starts on</Label>
        <Select
          value={weekStart}
          onValueChange={(v) =>
            setValue('weekStart', v as 'sunday' | 'monday', { shouldDirty: true })
          }
        >
          <SelectTrigger id="h-week-start">
            <SelectValue placeholder="Select a day" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sunday">Sunday</SelectItem>
            <SelectItem value="monday">Monday</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      <div className="mt-8 border-t border-danger/30 pt-6">
        <h2 className="text-lg font-semibold text-danger">Danger zone</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Deleting a household soft-deletes it for 30 days, then purges the data.
        </p>
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="destructive" className="mt-3">
              Delete household
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Deletion is not yet implemented</DialogTitle>
              <DialogDescription>
                Full delete + 30-day tombstone ships in M10. Reach out to the operator if you need
                to remove a household before then.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" type="button">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </form>
  );
}
