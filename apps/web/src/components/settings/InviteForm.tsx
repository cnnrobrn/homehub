/**
 * Invite-a-member form.
 *
 * Renders email + role + per-segment grants. On submit, displays the
 * generated invite URL once (the raw token is only returned on creation;
 * we never persist it). Owner-only — the parent page gates rendering by
 * `ctx.member.role === 'owner'`.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Clipboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { inviteMemberAction } from '@/app/actions/household';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

type Segment = 'financial' | 'food' | 'fun' | 'social';

const SEGMENTS: ReadonlyArray<{ id: Segment; label: string }> = [
  { id: 'financial', label: 'Financial' },
  { id: 'food', label: 'Food' },
  { id: 'fun', label: 'Fun' },
  { id: 'social', label: 'Social' },
];

const schema = z.object({
  email: z.string().email('Enter a valid email.'),
  role: z.enum(['adult', 'child', 'guest']),
  grants: z
    .array(
      z.object({
        segment: z.enum(['financial', 'food', 'fun', 'social']),
        access: z.enum(['none', 'read', 'write']),
      }),
    )
    .default([]),
});
type Values = z.infer<typeof schema>;

function defaultGrantsFor(
  role: 'adult' | 'child' | 'guest',
): Record<Segment, 'none' | 'read' | 'write'> {
  switch (role) {
    case 'adult':
      return { financial: 'write', food: 'write', fun: 'write', social: 'write' };
    case 'child':
      return { financial: 'none', food: 'write', fun: 'write', social: 'read' };
    case 'guest':
      return { financial: 'none', food: 'read', fun: 'read', social: 'read' };
  }
}

export function InviteForm({ householdId, appUrl }: { householdId: string; appUrl: string }) {
  const router = useRouter();
  const [issuedLink, setIssuedLink] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', role: 'adult', grants: [] },
  });

  const role = watch('role');
  const [grantState, setGrantState] = React.useState<Record<Segment, 'none' | 'read' | 'write'>>(
    defaultGrantsFor('adult'),
  );

  // Sync defaults when role changes so the boxes reflect the backend default.
  React.useEffect(() => {
    setGrantState(defaultGrantsFor(role));
  }, [role]);

  async function onSubmit(values: Values) {
    const grants = SEGMENTS.map((s) => ({ segment: s.id, access: grantState[s.id] })).filter(
      (g) => g.access !== 'none',
    );
    const res = await inviteMemberAction({
      householdId,
      email: values.email,
      role: values.role,
      grants,
    });
    if (!res.ok) {
      toast({
        variant: 'destructive',
        title: 'Could not send invitation',
        description: res.error.message,
      });
      return;
    }
    const link = `${appUrl.replace(/\/$/, '')}/invite/${res.data.token}`;
    setIssuedLink(link);
    reset({ email: '', role: 'adult', grants: [] });
    setGrantState(defaultGrantsFor('adult'));
    router.refresh();
  }

  async function copyLink() {
    if (!issuedLink) return;
    try {
      await navigator.clipboard.writeText(issuedLink);
      toast({ title: 'Link copied' });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not copy',
        description: 'Your browser blocked clipboard access.',
      });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          autoComplete="off"
          aria-invalid={errors.email ? 'true' : 'false'}
          {...register('email')}
        />
        <FormMessage error={errors.email?.message ?? null} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-role">Role</Label>
        <Select
          value={role}
          onValueChange={(v) => setValue('role', v as 'adult' | 'child' | 'guest')}
        >
          <SelectTrigger id="invite-role">
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="adult">Adult</SelectItem>
            <SelectItem value="child">Child</SelectItem>
            <SelectItem value="guest">Guest</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Segment access</legend>
        <div className="grid grid-cols-2 gap-3">
          {SEGMENTS.map((s) => {
            const value = grantState[s.id];
            return (
              <label
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`grant-${s.id}`}
                    checked={value !== 'none'}
                    onCheckedChange={(checked) =>
                      setGrantState((prev) => ({
                        ...prev,
                        [s.id]: checked === true ? 'write' : 'none',
                      }))
                    }
                  />
                  <span>{s.label}</span>
                </div>
                <select
                  aria-label={`${s.label} access`}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
                  value={value}
                  onChange={(e) =>
                    setGrantState((prev) => ({
                      ...prev,
                      [s.id]: e.target.value as 'none' | 'read' | 'write',
                    }))
                  }
                >
                  <option value="none">none</option>
                  <option value="read">read</option>
                  <option value="write">write</option>
                </select>
              </label>
            );
          })}
        </div>
      </fieldset>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Generate invite'}
      </Button>

      {issuedLink ? (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4">
          <p className="text-sm font-medium">Share this link — it&apos;s only shown once.</p>
          <div className="mt-2 flex items-center gap-2">
            <Input readOnly value={issuedLink} aria-label="Invitation link" />
            <Button type="button" onClick={copyLink} size="icon" aria-label="Copy link">
              <Clipboard className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
