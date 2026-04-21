/**
 * `/invite/[token]` — accept-an-invitation landing.
 *
 * Renders from the server with the preview already resolved so the first
 * paint shows household name, role, and inviter. Three terminal shapes:
 *
 *   1. unauthenticated, valid invite → "sign in to accept" CTA that
 *      routes through `/login?next=/invite/<token>`.
 *   2. authenticated, valid invite → "Accept" button, wired to
 *      `acceptInvitationAction`. On success: `router.push('/')`.
 *   3. invalid / expired / already accepted → friendly error card.
 */

import { getUser } from '@homehub/auth-server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { previewInvitationAction } from '@/app/actions/household';
import { AcceptInvitationPanel } from '@/components/auth/AcceptInvitationPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { nextCookieAdapter } from '@/lib/auth/cookies';
import { authEnv } from '@/lib/auth/env';

export const metadata: Metadata = {
  title: 'Join household',
};

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const preview = await previewInvitationAction({ token });

  const cookies = await nextCookieAdapter();
  const env = authEnv();
  const user = await getUser(env, cookies);

  if (!preview.ok) {
    return (
      <InviteShell>
        <InviteErrorCard
          title="We couldn't load this invitation"
          description={preview.error.message}
        />
      </InviteShell>
    );
  }

  if (!preview.data) {
    return (
      <InviteShell>
        <InviteErrorCard
          title="Invitation not found"
          description="This link may have been mistyped, revoked, or is for a household that no longer exists."
        />
      </InviteShell>
    );
  }

  const inv = preview.data;

  if (inv.status === 'expired') {
    return (
      <InviteShell>
        <InviteErrorCard
          title="Invitation expired"
          description={`This invitation expired on ${formatDate(inv.expiresAt)}. Ask the person who invited you to send a new one.`}
        />
      </InviteShell>
    );
  }

  if (inv.status === 'accepted') {
    return (
      <InviteShell>
        <InviteErrorCard
          title="Already accepted"
          description="This invitation has already been used. If that wasn't you, ask the household owner to issue a new one."
          cta={{ href: '/', label: 'Go home' }}
        />
      </InviteShell>
    );
  }

  // Status = 'valid'.
  if (!user) {
    // Unauthenticated — send them through /login and come back.
    const signInHref = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;
    return (
      <InviteShell>
        <Card>
          <CardHeader>
            <CardTitle>You&apos;re invited to {inv.household.name}</CardTitle>
            <CardDescription>
              {inv.inviterName ? `${inv.inviterName} invited you` : 'You were invited'} to join as{' '}
              <strong>{inv.role}</strong>. Sign in with <strong>{inv.email}</strong> to accept.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link href={signInHref}>Sign in to accept</Link>
            </Button>
            <p className="text-xs text-fg-muted">Expires {formatDate(inv.expiresAt)}.</p>
          </CardContent>
        </Card>
      </InviteShell>
    );
  }

  // Authenticated — but if their email does not match the invitation email,
  // surface a friendly warning. The accept flow will still work (we match on
  // the invitation row, not the user's email), but the owner may have sent
  // the invite to a specific address.
  const emailMismatch = user.email && user.email.toLowerCase() !== inv.email.toLowerCase();

  if (inv.status !== 'valid') {
    // Defensive: the switch above covered every non-'valid' case.
    redirect('/');
  }

  return (
    <InviteShell>
      <Card>
        <CardHeader>
          <CardTitle>Join {inv.household.name}</CardTitle>
          <CardDescription>
            {inv.inviterName ? `${inv.inviterName} invited you` : 'You were invited'} as{' '}
            <strong>{inv.role}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {emailMismatch ? (
            <p className="text-xs text-warn">
              Heads up: this invitation was sent to <strong>{inv.email}</strong>, but you&apos;re
              signed in as <strong>{user.email}</strong>. If that&apos;s intentional, you can still
              accept — otherwise, sign out and sign in with the right account.
            </p>
          ) : null}
          <AcceptInvitationPanel token={token} householdName={inv.household.name} />
          <p className="text-xs text-fg-muted">Expires {formatDate(inv.expiresAt)}.</p>
        </CardContent>
      </Card>
    </InviteShell>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">HomeHub</h1>
      {children}
    </div>
  );
}

function InviteErrorCard({
  title,
  description,
  cta = { href: '/', label: 'Go home' },
}: {
  title: string;
  description: string;
  cta?: { href: string; label: string };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}
