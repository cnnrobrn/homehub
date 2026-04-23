/**
 * First-run onboarding form with two tabs: create household vs. join by
 * invite. On success either path refreshes the app shell — the
 * `(app)/layout.tsx` context resolver picks up the new membership.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { acceptInvitationAction, createHouseholdAction } from '@/app/actions/household';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';

const createSchema = z.object({
  name: z.string().min(1, 'Give your household a name.').max(200),
  timezone: z.string().min(1, 'Pick a timezone.').max(64),
});
type CreateValues = z.infer<typeof createSchema>;

// Currency is fixed to USD at onboarding; owners can change it later in
// household settings if we ever need non-USD support.
const DEFAULT_CURRENCY = 'USD';

// Full IANA timezone list from the browser. `Intl.supportedValuesOf` is
// available in every modern engine we support; a minimal fallback keeps
// the form usable on older runtimes.
function getTimezoneOptions(): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      // fall through
    }
  }
  return [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'UTC',
  ];
}

const joinSchema = z.object({
  token: z
    .string()
    .min(1, 'Paste your invite link or token.')
    .transform((v) => {
      // Accept either a token or a full `/invite/<token>` URL.
      const match = v.match(/invite\/([^/?#]+)/);
      return match ? match[1]! : v.trim();
    }),
});
type JoinValues = z.infer<typeof joinSchema>;

export function OnboardingForm() {
  return (
    <Card className="w-full">
      <CardContent className="pt-6">
        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create">Create</TabsTrigger>
            <TabsTrigger value="join">Join by invite</TabsTrigger>
          </TabsList>
          <TabsContent value="create">
            <CreateHouseholdInner />
          </TabsContent>
          <TabsContent value="join">
            <JoinInner />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CreateHouseholdInner() {
  const router = useRouter();

  // Pick up the user's browser timezone as a default. `Intl.DateTimeFormat`
  // is stable on a given client, so reading it during render avoids both a
  // hydration mismatch and a useEffect round-trip.
  const defaultTz = React.useMemo(() => {
    if (typeof Intl === 'undefined') return 'UTC';
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);
  const timezoneOptions = React.useMemo(() => {
    const list = getTimezoneOptions();
    return list.includes(defaultTz) ? list : [defaultTz, ...list];
  }, [defaultTz]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', timezone: defaultTz },
  });

  // RHF needs to know `timezone` is a tracked field; we drive it imperatively
  // via setValue rather than wiring the Select to its onChange directly.
  React.useEffect(() => {
    register('timezone');
  }, [register]);
  const timezone = watch('timezone');

  async function onSubmit(values: CreateValues) {
    const res = await createHouseholdAction({
      name: values.name,
      timezone: values.timezone,
      currency: DEFAULT_CURRENCY,
    });
    if (!res.ok) {
      toast({
        variant: 'destructive',
        title: 'Could not create household',
        description: res.error.message,
      });
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 pt-2"
      aria-labelledby="create-heading"
      noValidate
    >
      <h3 id="create-heading" className="sr-only">
        Create a household
      </h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="household-name">Household name</Label>
        <Input
          id="household-name"
          autoFocus
          autoComplete="off"
          placeholder="The Martins"
          required
          aria-invalid={errors.name ? 'true' : 'false'}
          {...register('name')}
        />
        <FormMessage error={errors.name?.message ?? null} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="household-tz">Timezone</Label>
        <Select
          value={timezone}
          onValueChange={(v) => setValue('timezone', v, { shouldValidate: true })}
        >
          <SelectTrigger id="household-tz" aria-invalid={errors.timezone ? 'true' : 'false'}>
            <SelectValue placeholder="Select a timezone" />
          </SelectTrigger>
          <SelectContent>
            {timezoneOptions.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormMessage error={errors.timezone?.message ?? null} />
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating…' : 'Create household'}
      </Button>
    </form>
  );
}

function JoinInner() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<JoinValues>({ resolver: zodResolver(joinSchema) });

  async function onSubmit(values: JoinValues) {
    const res = await acceptInvitationAction({ token: values.token });
    if (!res.ok) {
      toast({
        variant: 'destructive',
        title: 'Could not accept invitation',
        description: res.error.message,
      });
      return;
    }
    toast({ variant: 'success', title: 'Welcome!' });
    router.replace('/');
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 pt-2"
      aria-labelledby="join-heading"
      noValidate
    >
      <h3 id="join-heading" className="sr-only">
        Join with an invite
      </h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-token">Invite link or token</Label>
        <Input
          id="invite-token"
          autoComplete="off"
          placeholder="https://…/invite/abc123… or abc123…"
          aria-invalid={errors.token ? 'true' : 'false'}
          {...register('token')}
        />
        <FormMessage error={errors.token?.message ?? null} />
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Joining…' : 'Join household'}
      </Button>
    </form>
  );
}
