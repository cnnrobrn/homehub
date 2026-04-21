/**
 * Realtime-refresher client island.
 *
 * Subscribes to `postgres_changes` on `app.event` for the current
 * household and re-fetches the Server Component tree on any INSERT /
 * UPDATE / DELETE. The debounce collapses the typical sync-gcal burst
 * (dozens of upserts arriving back-to-back when a worker finishes a
 * page fetch) into a single `router.refresh()`.
 *
 * NOTE (MVP): re-fetching the whole window on any change is not ideal
 * — a smarter diff-apply would keep the grid stable during scroll. That
 * optimization is deferred to M3+; for the M2-C calendar MVP it is
 * cheap enough (`router.refresh()` only re-renders Server Components,
 * not the whole client tree) and keeps the code path small.
 *
 * The hook unmounts with the route — Next 15's Client Component
 * lifecycle guarantees `useEffect` cleanup runs on navigation away, so
 * we don't leak Supabase channels.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

export interface RealtimeEventRefresherProps {
  householdId: string;
  debounceMs?: number;
}

export function RealtimeEventRefresher({
  householdId,
  debounceMs = 500,
}: RealtimeEventRefresherProps) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!householdId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`events:${householdId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'app',
          table: 'event',
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            router.refresh();
            timeoutRef.current = null;
          }, debounceMs);
        },
      )
      .subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [householdId, debounceMs, router]);

  return null;
}
