/**
 * Realtime-refresher client island for the Social segment.
 *
 * Subscribes to `postgres_changes` on `app.event`, `app.alert`,
 * `app.suggestion`, and `mem.node` — all filtered by `household_id`.
 * Debounces bursts into a single `router.refresh()`.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

export interface SocialRealtimeRefresherProps {
  householdId: string;
  debounceMs?: number;
}

type Sub = { schema: 'app' | 'mem'; table: string };

const SUBSCRIPTIONS: Sub[] = [
  { schema: 'app', table: 'event' },
  { schema: 'app', table: 'alert' },
  { schema: 'app', table: 'suggestion' },
  { schema: 'mem', table: 'node' },
];

export function SocialRealtimeRefresher({
  householdId,
  debounceMs = 500,
}: SocialRealtimeRefresherProps) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!householdId) return;
    const supabase = createClient();
    const schedule = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        router.refresh();
        timeoutRef.current = null;
      }, debounceMs);
    };

    let channel = supabase.channel(`social:${householdId}`);
    for (const s of SUBSCRIPTIONS) {
      channel = channel.on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: s.schema,
          table: s.table,
          filter: `household_id=eq.${householdId}`,
        },
        () => schedule(),
      );
    }
    channel.subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [householdId, debounceMs, router]);

  return null;
}
