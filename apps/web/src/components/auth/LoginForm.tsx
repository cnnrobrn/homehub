/**
 * Client-side login form.
 *
 * Renders the two auth flows as a single form:
 *   - Email → submit triggers `signInWithEmailAction` (magic link).
 *   - Google → separate button triggers `signInWithGoogleAction`.
 *
 * After a successful magic-link send we show a "check your inbox" panel
 * in place of the form; the page reloads when the user clicks the link
 * from their mail client and hits `/auth/callback`.
 *
 * Styling follows the marketing site's indie-software system: tight
 * 3px radii, mono-caps divider, warm-sand note block for the confirmed
 * state. The shared `Button`/`Input` primitives are kept — they already
 * resolve from the same tokens as the marketing palette.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { signInWithEmailAction, signInWithGoogleAction } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

const schema = z.object({
  email: z.string().email('Enter a valid email.'),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm({ next }: { next: string }) {
  const [sent, setSent] = React.useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onEmailSubmit(values: FormValues) {
    const res = await signInWithEmailAction({ email: values.email, next });
    if (!res.ok) {
      setError('email', { message: res.error.message });
      return;
    }
    setSent(values.email);
  }

  async function onGoogleClick() {
    setGoogleLoading(true);
    const res = await signInWithGoogleAction({ next });
    if (!res.ok) {
      toast({
        variant: 'destructive',
        title: 'Google sign-in failed',
        description: res.error.message,
      });
      setGoogleLoading(false);
      return;
    }
    window.location.href = res.data.redirectTo;
  }

  if (sent) {
    return (
      <div className="border-border bg-surface-note flex flex-col gap-2 rounded-[6px] border border-l-2 border-l-[var(--color-accent)] p-5">
        <div className="font-mono text-[10px] tracking-[0.5px] text-fg-muted">
          — CHECK YOUR INBOX
        </div>
        <p className="text-[14px] leading-[1.55] text-fg">
          We sent a sign-in link to <strong className="font-semibold">{sent}</strong>.
        </p>
        <p className="text-[12.5px] leading-[1.5] text-fg-muted">
          Open it on this device to finish signing in. You can close this tab.
        </p>
        <button
          type="button"
          className="mt-2 self-start font-mono text-[11px] tracking-[0.5px] text-fg-muted underline underline-offset-4 transition-colors hover:text-fg"
          onClick={() => setSent(null)}
        >
          use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <Button
        type="button"
        variant="outline"
        className="border-border h-10 w-full rounded-[3px] text-[14px] font-normal"
        onClick={onGoogleClick}
        disabled={googleLoading}
        aria-label="Continue with Google"
      >
        {googleLoading ? 'opening google…' : 'continue with google'}
      </Button>
      <div className="flex items-center gap-3" aria-hidden="true">
        <div className="bg-border h-px flex-1" />
        <span className="font-mono text-[10px] tracking-[1px] text-fg-muted">OR</span>
        <div className="bg-border h-px flex-1" />
      </div>
      <form onSubmit={handleSubmit(onEmailSubmit)} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="email"
            className="font-mono text-[10px] tracking-[0.5px] text-fg-muted uppercase"
          >
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@household.com"
            required
            className="h-10 rounded-[3px] text-[14px]"
            aria-invalid={errors.email ? 'true' : 'false'}
            {...register('email')}
          />
          <FormMessage error={errors.email?.message ?? null} />
        </div>
        <Button
          type="submit"
          className="bg-fg text-bg hover:bg-fg/90 h-10 w-full rounded-[3px] text-[14px] font-medium"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'sending link…' : 'send magic link →'}
        </Button>
      </form>
    </div>
  );
}
