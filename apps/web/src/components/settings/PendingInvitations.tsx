/**
 * Pending-invitations list. Server component — we only need the tokens
 * for the link format (we don't have raw tokens here, so the "Copy link"
 * button copies a note explaining re-issuance is required; this is fine
 * because the raw token is only surfaced on the invite-create response).
 */

'use client';

import { Clipboard } from 'lucide-react';
import * as React from 'react';

import type { ListInvitationsResult } from '@homehub/auth-server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

interface Props {
  invitations: ListInvitationsResult[];
  appUrl: string;
}

export function PendingInvitations({ invitations, appUrl }: Props) {
  if (invitations.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No pending invitations.
      </div>
    );
  }

  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      toast({ title: 'Email copied', description: email });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not copy',
        description: 'Your browser blocked clipboard access.',
      });
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs uppercase text-fg-muted">
          <tr>
            <th scope="col" className="px-4 py-2">
              Email
            </th>
            <th scope="col" className="px-4 py-2">
              Role
            </th>
            <th scope="col" className="px-4 py-2">
              Expires
            </th>
            <th scope="col" className="px-4 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invitations.map((inv) => (
            <tr key={inv.id}>
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="font-medium">{inv.email}</span>
                  {inv.invitedByDisplayName ? (
                    <span className="text-xs text-fg-muted">
                      Invited by {inv.invitedByDisplayName}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge variant="secondary">{inv.role}</Badge>
              </td>
              <td className="px-4 py-3 text-fg-muted">
                {new Date(inv.expiresAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyEmail(inv.email)}
                  aria-label={`Copy ${inv.email}`}
                >
                  <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">Copy email</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border bg-surface px-4 py-2 text-xs text-fg-muted">
        Invitation links are only displayed when first created. If you lost one, re-invite the
        member below to generate a fresh link. App URL: {appUrl || 'not set'}
      </p>
    </div>
  );
}
