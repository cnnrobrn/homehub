/**
 * Search island for the `/memory` index.
 *
 * Debounced (250ms) client-side input that posts to the
 * `searchMemoryAction` server action and renders the top results
 * in an inline results panel. Keyboard-reachable; each result is a
 * link to the relevant node detail page.
 *
 * The island intentionally does not use URL state — the list is
 * ephemeral; the left-rail navigator is the stable navigation
 * surface. If the member opens a result in a new tab, they land
 * on `/memory/[type]/[nodeId]` directly.
 */

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { searchMemoryAction } from '@/app/actions/memory';
import { Input } from '@/components/ui/input';

interface ResultNode {
  id: string;
  type: string;
  canonical_name: string;
}

export interface MemorySearchProps {
  householdId: string;
  /** Debounce in milliseconds. Tests pass `0` for determinism. */
  debounceMs?: number;
}

export function MemorySearch({ householdId, debounceMs = 250 }: MemorySearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResultNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeQueryRef = useRef<string>('');

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (query.trim().length === 0) {
      setResults([]);
      setErrorMessage(null);
      setLoading(false);
      return;
    }

    const run = async () => {
      const submitted = query.trim();
      activeQueryRef.current = submitted;
      setLoading(true);
      try {
        const res = await searchMemoryAction({ householdId, query: submitted, limit: 10 });
        // Ignore stale responses from races.
        if (activeQueryRef.current !== submitted) return;
        if (!res.ok) {
          setErrorMessage(res.error.message);
          setResults([]);
        } else {
          setErrorMessage(null);
          setResults(res.data.nodes);
        }
      } catch (err) {
        if (activeQueryRef.current !== submitted) return;
        setErrorMessage(err instanceof Error ? err.message : 'search failed');
        setResults([]);
      } finally {
        if (activeQueryRef.current === submitted) setLoading(false);
      }
    };

    if (debounceMs <= 0) {
      void run();
    } else {
      timeoutRef.current = setTimeout(() => {
        void run();
      }, debounceMs);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, householdId, debounceMs]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg">Search memory</span>
        <Input
          type="search"
          placeholder="People, places, dishes, topics…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search memory"
          aria-busy={loading}
        />
      </label>
      {errorMessage ? (
        <p className="text-sm text-danger" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul
          className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface"
          aria-label="Search results"
        >
          {results.map((n) => (
            <li key={n.id}>
              <Link
                href={`/memory/${n.type}/${n.id}` as never}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-bg/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="truncate font-medium">{n.canonical_name}</span>
                <span className="text-xs text-fg-muted">{n.type}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {query.trim().length > 0 && !loading && results.length === 0 && !errorMessage ? (
        <p className="text-sm text-fg-muted">No matches.</p>
      ) : null}
    </div>
  );
}
