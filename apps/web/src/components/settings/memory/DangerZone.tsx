/**
 * Owner-only danger zone for the memory settings page.
 *
 * "Forget everything" records an intent to purge with a 48h soft-delete
 * window — the actual purge ships in M10. The confirmation dialog uses
 * type-to-confirm (the standard for destructive ops in the app) so the
 * owner can't click through by accident.
 *
 * "Undo forget" only renders when a pending request exists within the
 * last 48h. It writes a cancel event to the audit log.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  cancelForgetAllAction,
  requestForgetAllAction,
  type ForgetAllRequestStatus,
} from '@/app/actions/memory';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

const CONFIRM_PHRASE = 'delete everything';

export interface DangerZoneProps {
  pendingRequest: ForgetAllRequestStatus | null;
}

export function DangerZone({ pendingRequest }: DangerZoneProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phrase, setPhrase] = useState('');

  const runForget = () => {
    if (phrase.trim().toLowerCase() !== CONFIRM_PHRASE) return;
    startTransition(async () => {
      const res = await requestForgetAllAction();
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not schedule forget',
          description: res.error.message,
        });
        return;
      }
      toast({
        variant: 'success',
        title: 'Forget scheduled',
        description:
          'Forgetting is scheduled for 48h — you can still undo in Settings for the next 2 days.',
      });
      setDialogOpen(false);
      setPhrase('');
      router.refresh();
    });
  };

  const runCancel = () => {
    startTransition(async () => {
      const res = await cancelForgetAllAction();
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not cancel forget',
          description: res.error.message,
        });
        return;
      }
      toast({ variant: 'success', title: 'Forget canceled' });
      router.refresh();
    });
  };

  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle className="text-danger">Danger zone</CardTitle>
        <CardDescription>
          Irreversible actions. The real purge worker ships in M10 — for now, &ldquo;forget
          everything&rdquo; records intent in the audit log with a 48-hour cancellation window.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pendingRequest ? (
          <div className="flex flex-col gap-2 rounded-md border border-warn/40 bg-warn/10 p-4 text-sm">
            <div className="font-medium text-warn">Forget scheduled</div>
            <p className="text-fg-muted">
              Forget-everything requested at{' '}
              <time dateTime={pendingRequest.requestedAt}>
                {new Date(pendingRequest.requestedAt).toLocaleString()}
              </time>
              . You have until{' '}
              <time dateTime={pendingRequest.expiresAt}>
                {new Date(pendingRequest.expiresAt).toLocaleString()}
              </time>{' '}
              to cancel. The real purge ships in M10.
            </p>
            <div>
              <Button variant="outline" onClick={runCancel} disabled={pending}>
                {pending ? 'Canceling…' : 'Undo forget'}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-fg">Forget everything</span>
            <span className="text-xs text-fg-muted">
              Schedules deletion of every memory for this household. Will not actually purge until
              the M10 worker ships; intent + cancellation are logged to audit.
            </span>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <Button
              variant="destructive"
              disabled={pending || !!pendingRequest}
              onClick={() => setDialogOpen(true)}
            >
              Forget everything…
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Forget everything?</DialogTitle>
                <DialogDescription>
                  This will schedule the destruction of every episode, fact, pattern, and insight
                  for this household in 48 hours. You can cancel it in Settings for the next 2 days.
                  The actual purge worker lands in M10; until then, this only records the intent.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="forget-confirm-phrase">
                  Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm
                </Label>
                <Input
                  id="forget-confirm-phrase"
                  value={phrase}
                  onChange={(e) => setPhrase(e.currentTarget.value)}
                  autoComplete="off"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    setPhrase('');
                  }}
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending || phrase.trim().toLowerCase() !== CONFIRM_PHRASE}
                  onClick={runForget}
                >
                  {pending ? 'Scheduling…' : 'Schedule forget'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
