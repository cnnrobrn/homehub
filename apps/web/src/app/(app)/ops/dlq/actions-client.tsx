/**
 * Per-row client-side actions for `/ops/dlq`.
 *
 * Kept client-side so the buttons can call server actions and refresh
 * the route on completion. The server actions do the real auth + audit
 * work — this surface is presentational.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { purgeDlqEntryAction, replayDlqEntryAction } from '@/app/actions/ops';

export function DlqActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const replay = () => {
    startTransition(async () => {
      const result = await replayDlqEntryAction({ id });
      if (!result.ok) {
        alert(`Replay failed: ${result.error.message}`);
        return;
      }
      if (!result.data.enqueued) {
        alert(`Replay rejected: ${result.data.reason ?? 'unknown reason'}`);
        return;
      }
      router.refresh();
    });
  };

  const purge = () => {
    if (!confirm('Purge this dead-letter entry? This cannot be undone.')) return;
    startTransition(async () => {
      const result = await purgeDlqEntryAction({ id });
      if (!result.ok) {
        alert(`Purge failed: ${result.error.message}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={replay}
        disabled={pending}
        className="rounded border border-border px-2 py-1 text-xs hover:bg-bg/40 disabled:opacity-50"
      >
        {pending ? 'Working…' : 'Replay'}
      </button>
      <button
        type="button"
        onClick={purge}
        disabled={pending}
        className="rounded border border-border px-2 py-1 text-xs hover:bg-bg/40 disabled:opacity-50"
      >
        Purge
      </button>
    </div>
  );
}
