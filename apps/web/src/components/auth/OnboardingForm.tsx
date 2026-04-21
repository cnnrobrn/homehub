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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';

const createSchema = z.object({
  name: z.string().min(1, 'Give your household a name.').max(200),
  timezone: z.string().max(64).optional(),
  currency: z
    .string()
    .length(3, 'Currency must be a 3-letter code (e.g. USD).')
    .optional()
    .or(z.literal('')),
});
type CreateValues = z.infer<typeof createSchema>;

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
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({ resolver: zodResolver(createSchema) });

  async function onSubmit(values: CreateValues) {
    const res = await createHouseholdAction({
      name: values.name,
      ...(values.timezone ? { timezone: values.timezone } : {}),
      ...(values.currency ? { currency: values.currency } : {}),
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

  // Pick up the user's browser timezone as a default. Done in the
  // render path rather than a useEffect to avoid a hydration mismatch —
  // `Intl.DateTimeFormat().resolvedOptions().timeZone` is stable on a
  // given client.
  const defaultTz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

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
        <Label htmlFor="household-tz">Timezone (optional)</Label>
        <Input
          id="household-tz"
          defaultValue={defaultTz ?? ''}
          placeholder="America/New_York"
          {...register('timezone')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="household-currency">Currency (optional)</Label>
        <Input
          id="household-currency"
          placeholder="USD"
          maxLength={3}
          aria-invalid={errors.currency ? 'true' : 'false'}
          {...register('currency')}
        />
        <FormMessage error={errors.currency?.message ?? null} />
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
