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
import { Separator } from '@/components/ui/separator';
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
    // Follow the URL Supabase prepared — full page redirect so the OAuth
    // consent screen takes over.
    window.location.href = res.data.redirectTo;
  }

  if (sent) {
    return (
      <div className="w-full rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-sm text-fg">
          We sent a sign-in link to <strong>{sent}</strong>.
        </p>
        <p className="mt-2 text-xs text-fg-muted">
          Open it on this device to finish signing in. You can close this tab.
        </p>
        <button
          type="button"
          className="mt-4 text-xs text-accent underline underline-offset-4"
          onClick={() => setSent(null)}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onGoogleClick}
        disabled={googleLoading}
        aria-label="Continue with Google"
      >
        {googleLoading ? 'Opening Google…' : 'Continue with Google'}
      </Button>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs uppercase text-fg-muted">or</span>
        <Separator className="flex-1" />
      </div>
      <form onSubmit={handleSubmit(onEmailSubmit)} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={errors.email ? 'true' : 'false'}
            {...register('email')}
          />
          <FormMessage error={errors.email?.message ?? null} />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Sending link…' : 'Send magic link'}
        </Button>
      </form>
      <p className="text-xs text-fg-muted">
        We use passwordless email for everyone — no sign-up step required.
      </p>
    </div>
  );
}
