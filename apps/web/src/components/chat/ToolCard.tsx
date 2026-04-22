'use client';

/**
 * Collapsible tool-call card rendered inline in the assistant turn.
 *
 * Visually calm: hairline border, a mono tool name, a single-line
 * summary, and an "open" / "close" toggle. Draft-writes get a teal
 * accent stripe on the left edge; errors get a warmer ink tone with
 * a subtle red tag. No emoji, no filled icons.
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
        'my-2 rounded-[4px] border bg-surface text-[12px] text-fg',
        isError
          ? 'border-border bg-surface-note'
          : isDraftWrite
            ? 'border-border border-l-[3px] border-l-accent'
            : 'border-border',
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
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'inline-block h-[6px] w-[6px] rounded-full',
              streaming
                ? 'animate-pulse bg-accent'
                : isError
                  ? 'bg-[oklch(0.55_0.15_25)]'
                  : isDraftWrite
                    ? 'bg-accent'
                    : 'bg-fg-muted',
            )}
            aria-hidden="true"
          />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
            {call.tool}
          </span>
          <span className="text-fg-muted">·</span>
          <span className="text-[12.5px] leading-[1.5] text-fg">{summarize(call)}</span>
        </span>
        <span className="font-mono text-[12px] text-fg-muted">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className="border-t border-border px-3 py-2 font-mono text-[11px] text-fg-muted">
          <div>
            <span className="text-fg">args:</span>
            <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
          </div>
          {call.ok !== false ? (
            <div className="mt-2">
              <span className="text-fg">result:</span>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(call.result, null, 2).slice(0, 1200)}
              </pre>
            </div>
          ) : (
            <div className="mt-2 text-fg">
              <span className="font-mono">error:</span> {call.error?.code}: {call.error?.message}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
