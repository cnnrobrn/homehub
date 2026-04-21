/**
 * Current-members table.
 *
 * Rendered as a Client Component so the Revoke / Transfer confirmations
 * can open inline. Non-owners see a read-only shape (no action column).
 */

'use client';

import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import type { ListMembersResult } from '@homehub/auth-server';

import { revokeMemberAction, transferOwnershipAction } from '@/app/actions/members';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';

interface MemberListProps {
  householdId: string;
  members: ListMembersResult[];
  viewerMemberId: string;
  viewerIsOwner: boolean;
}

type PendingAction = { kind: 'revoke' | 'transfer'; memberId: string; name: string } | null;

export function MemberList({
  householdId,
  members,
  viewerMemberId,
  viewerIsOwner,
}: MemberListProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState<PendingAction>(null);
  const [busy, startBusy] = React.useTransition();

  function runPending() {
    if (!pending) return;
    startBusy(async () => {
      const res =
        pending.kind === 'revoke'
          ? await revokeMemberAction({ householdId, targetMemberId: pending.memberId })
          : await transferOwnershipAction({ householdId, newOwnerMemberId: pending.memberId });
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title:
            pending.kind === 'revoke' ? 'Could not revoke member' : 'Could not transfer ownership',
          description: res.error.message,
        });
        return;
      }
      toast({
        variant: 'success',
        title: pending.kind === 'revoke' ? 'Member revoked' : 'Ownership transferred',
      });
      setPending(null);
      router.refresh();
    });
  }

  if (members.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-2">
                Name
              </th>
              <th scope="col" className="px-4 py-2">
                Role
              </th>
              <th scope="col" className="px-4 py-2">
                Segment access
              </th>
              <th scope="col" className="px-4 py-2">
                Joined
              </th>
              {viewerIsOwner ? (
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-medium">{m.displayName}</span>
                    {!m.connected ? (
                      <span className="text-xs text-fg-muted">Not signed in yet</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>{m.role}</Badge>
                </td>
                <td className="px-4 py-3">
                  <GrantsSummary grants={m.grants} />
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}
                </td>
                {viewerIsOwner ? (
                  <td className="px-4 py-3 text-right">
                    {m.id !== viewerMemberId ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${m.displayName}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {m.role === 'adult' ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                setPending({
                                  kind: 'transfer',
                                  memberId: String(m.id),
                                  name: m.displayName,
                                })
                              }
                            >
                              Transfer ownership
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({
                                kind: 'revoke',
                                memberId: String(m.id),
                                name: m.displayName,
                              })
                            }
                            className="text-danger"
                          >
                            Revoke access
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="text-xs text-fg-muted">You</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!pending} onOpenChange={(open) => (open ? null : setPending(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'revoke'
                ? `Revoke ${pending.name}?`
                : `Transfer ownership to ${pending?.name}?`}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === 'revoke'
                ? 'Their role will drop to guest and all segment grants will be cleared. They will not be removed from the household.'
                : 'They will become the household owner. Your role will change to adult.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={pending?.kind === 'revoke' ? 'destructive' : 'default'}
              onClick={runPending}
              disabled={busy}
            >
              {busy ? 'Working…' : pending?.kind === 'revoke' ? 'Revoke' : 'Transfer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GrantsSummary({ grants }: { grants: ListMembersResult['grants'] }) {
  const labeled = grants
    .filter((g) => g.segment !== 'system' && g.access !== 'none')
    .map((g) => `${g.segment}:${g.access}`);
  if (labeled.length === 0) {
    return <span className="text-fg-muted">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {labeled.map((l) => (
        <Badge key={l} variant="outline" className="text-xs">
          {l}
        </Badge>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
      No members yet.
    </div>
  );
}
