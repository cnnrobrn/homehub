'use client';

/**
 * Collapsible tool-call card rendered inline in the assistant turn.
 *
 * Accepts a tool-call record (name, args, result, classification) and
 * renders a summary with an expand affordance. Specialized rendering
 * lives in this file too — each tool name gets a tiny formatter.
 */

import * as React from 'react';

import { cn } from '@/lib/cn';

export interface ToolCallDisplay {
  id: string;
  tool: string;
  classification: string;
  arguments: Record<string, unknown>;
  result: unknown;
  latency_ms?: number;
  ok?: boolean;
  error?: { code: string; message: string };
}

interface ToolCardProps {
  call: ToolCallDisplay;
  streaming?: boolean;
}

function summarize(call: ToolCallDisplay): string {
  if (call.ok === false) return `${call.tool} failed: ${call.error?.message ?? 'unknown'}`;
  switch (call.tool) {
    case 'query_memory': {
      const q = (call.arguments['query'] as string) ?? '';
      const r = (call.result as { nodes?: unknown[]; facts?: unknown[] }) ?? {};
      return `searched "${q}" → ${r.nodes?.length ?? 0} nodes, ${r.facts?.length ?? 0} facts`;
    }
    case 'list_events': {
      const r = (call.result as { events?: unknown[] }) ?? {};
      return `fetched ${r.events?.length ?? 0} events`;
    }
    case 'list_transactions': {
      const r = (call.result as { transactions?: unknown[] }) ?? {};
      return `fetched ${r.transactions?.length ?? 0} transactions`;
    }
    case 'get_pantry': {
      const r = (call.result as { items?: unknown[] }) ?? {};
      return `read pantry (${r.items?.length ?? 0} items)`;
    }
    case 'remember_fact':
      return `remembered fact (candidate queued for promotion)`;
    case 'create_rule':
      return `created household rule`;
    default:
      return call.tool.replace(/_/g, ' ');
  }
}

export function ToolCard({ call, streaming = false }: ToolCardProps) {
  const [open, setOpen] = React.useState(false);
  const isError = call.ok === false;
  const isDraftWrite = call.classification === 'draft-write';
  return (
    <div
      className={cn(
        'my-2 rounded-md border px-3 py-2 text-xs',
        isError
          ? 'border-red-600/50 bg-red-50/10 text-red-700 dark:text-red-300'
          : isDraftWrite
            ? 'border-amber-600/50 bg-amber-50/10'
            : 'border-border bg-surface',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {streaming ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
          ) : (
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                isError ? 'bg-red-500' : isDraftWrite ? 'bg-amber-500' : 'bg-green-500',
              )}
              aria-hidden="true"
            />
          )}
          <span className="font-mono text-[11px] uppercase tracking-wide text-fg-muted">
            {call.tool}
          </span>
          <span>{summarize(call)}</span>
        </span>
        <span className="text-fg-muted">{open ? '-' : '+'}</span>
      </button>
      {open ? (
        <div className="mt-2 border-t border-border pt-2 font-mono text-[11px] text-fg-muted">
          <div>
            <span className="text-fg">args:</span>
            <pre className="overflow-x-auto">{JSON.stringify(call.arguments, null, 2)}</pre>
          </div>
          {call.ok !== false ? (
            <div className="mt-1">
              <span className="text-fg">result:</span>
              <pre className="overflow-x-auto">
                {JSON.stringify(call.result, null, 2).slice(0, 1200)}
              </pre>
            </div>
          ) : (
            <div className="mt-1 text-red-600">
              <span className="text-fg">error:</span> {call.error?.code}: {call.error?.message}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
