/**
 * Realtime refresher for the unified `/suggestions` page.
 *
 * Subscribes to `postgres_changes` on `app.suggestion` and `app.action`
 * filtered by `household_id`. Debounces bursts into a single
 * `router.refresh()`.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

export interface SuggestionsRealtimeRefresherProps {
  householdId: string;
  debounceMs?: number;
}

const TABLES = ['suggestion', 'action'] as const;

export function SuggestionsRealtimeRefresher({
  householdId,
  debounceMs = 500,
}: SuggestionsRealtimeRefresherProps) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!householdId) return;
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        router.refresh();
        timeoutRef.current = null;
      }, debounceMs);
    };

    let channel = supabase.channel(`suggestions:${householdId}`);
    for (const table of TABLES) {
      channel = channel.on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'app',
          table,
          filter: `household_id=eq.${householdId}`,
        },
        () => scheduleRefresh(),
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
