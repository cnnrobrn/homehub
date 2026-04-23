'use client';

/**
 * Active streaming message surface for an in-flight turn.
 *
 * Accepts an `AsyncIterable` of parsed SSE events via props (the
 * Composer creates one per submit). Renders tokens as they arrive,
 * inlines tool cards + suggestion cards, and surfaces an
 * "assistant is thinking" indicator before the first token.
 *
 * Visual language matches the static bot turn rendered in
 * `ChatThread` — HomeHubMark avatar in a ring, prose body to the
 * right, mono meta underneath. Streaming and event handling remain
 * identical; only the JSX layer was restyled.
 *
 * A11y: token chunks don't announce individually. The container is
 * `role="log"` so screen readers treat it as a live region but we
 * throttle AT updates via `aria-live="polite"` and only set
 * `data-sr-announce` at logical pauses (tool-call boundaries + the
 * final event).
 */

import * as React from 'react';


import { SuggestionCard } from './SuggestionCard';
import { ToolCard, type ToolCallDisplay } from './ToolCard';

import type { StreamEvent } from '@/lib/chat/streamClient';

import { HomeHubMark } from '@/components/design-system';

interface StreamingMessageProps {
  events: AsyncIterable<StreamEvent>;
  /** Called when the stream finishes; used by the parent to refresh. */
  onFinal?: () => void;
}

interface ToolCallState {
  call: ToolCallDisplay;
  streaming: boolean;
}

export function StreamingMessage({ events, onFinal }: StreamingMessageProps) {
  const [text, setText] = React.useState('');
  const [calls, setCalls] = React.useState<ToolCallState[]>([]);
  const [suggestions, setSuggestions] = React.useState<
    Array<{ callId: string; tool: string; summary: string; preview: unknown }>
  >([]);
  const [thinkingText, setThinkingText] = React.useState('');
  const [thinkingStatus, setThinkingStatus] = React.useState('');
  const [thinking, setThinking] = React.useState(true);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      setThinking(false);
      setDone(true);
      if (onFinal) onFinal();
    }
    (async () => {
      for await (const ev of events) {
        if (cancelled) break;
        switch (ev.type) {
          case 'start':
            setThinking(true);
            break;
          case 'intent':
            // no UI yet; context panel would render this.
            break;
          case 'token':
            setThinking(false);
            setText((prev) => prev + ev.delta);
            break;
          case 'thinking':
            setThinking(true);
            setThinkingText((prev) => prev + ev.delta);
            break;
          case 'thinking_status':
          case 'status':
            if (ev.message.trim()) {
              setThinking(true);
              setThinkingStatus(ev.message.trim());
            }
            break;
          case 'tool_generation':
            setThinking(true);
            setThinkingStatus(`using ${ev.tool}`);
            break;
          case 'tool_call_start':
            setCalls((prev) => [
              ...prev,
              {
                streaming: true,
                call: {
                  id: ev.callId,
                  tool: ev.tool,
                  classification: ev.classification ?? 'read',
                  arguments: ev.arguments,
                  result: null,
                },
              },
            ]);
            break;
          case 'tool_call_done':
            setCalls((prev) =>
              prev.map((c) =>
                c.call.id === ev.callId
                  ? {
                      streaming: false,
                      call: {
                        ...c.call,
                        classification: ev.classification,
                        result: ev.result,
                        latency_ms: ev.latencyMs,
                        ok: true,
                      },
                    }
                  : c,
              ),
            );
            break;
          case 'tool_call_error':
            setCalls((prev) =>
              prev.map((c) =>
                c.call.id === ev.callId
                  ? {
                      streaming: false,
                      call: {
                        ...c.call,
                        ok: false,
                        error: ev.error,
                      },
                    }
                  : c,
              ),
            );
            break;
          case 'suggestion_card':
            setSuggestions((prev) => [
              ...prev,
              {
                callId: ev.callId,
                tool: ev.tool,
                summary: ev.summary,
                preview: ev.preview,
              },
            ]);
            break;
          case 'citation':
            // The citation is already embedded in the token stream as
            // a [node:uuid] marker; we let the final render resolve it.
            break;
          case 'final':
            finish();
            break;
          case 'error':
            setText((prev) => `${prev}\n\n_stream error: ${ev.message}_`);
            finish();
            break;
        }
      }
      if (!cancelled) finish();
    })();
    return () => {
      cancelled = true;
    };
  }, [events, onFinal]);

  const hasThinkingDetails = thinkingText.trim().length > 0;
  const showThinking = (thinking && !done) || Boolean(thinkingStatus) || hasThinkingDetails;

  return (
    <div className="flex items-start gap-2.5" role="log" aria-live="polite">
      <div className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg">
        <HomeHubMark size={12} />
      </div>
      <div className="min-w-0 flex-1">
        {showThinking ? (
          <div className="mb-2 border-l border-border pl-2">
            <div className="font-mono text-[10.5px] tracking-[0.06em] text-fg-muted">
              <span className={thinking && !done ? 'animate-pulse text-accent' : ''}>
                {thinkingStatus || 'thinking...'}
              </span>
            </div>
            {hasThinkingDetails ? (
              <details
                className="mt-1 text-[12px] leading-[1.45] text-fg-muted"
                open={!text.trim()}
              >
                <summary className="cursor-pointer font-mono text-[10.5px] tracking-[0.06em]">
                  reasoning
                </summary>
                <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[4px] bg-surface-soft px-2 py-1.5">
                  {thinkingText}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
        {calls.map((c) => (
          <ToolCard key={c.call.id} call={c.call} streaming={c.streaming} />
        ))}
        {suggestions.map((s) => (
          <SuggestionCard key={s.callId} {...s} />
        ))}
        <div className="whitespace-pre-wrap text-[14.5px] leading-[1.6] text-fg">
          {text || (done ? <span className="text-fg-muted">(no response)</span> : '')}
        </div>
      </div>
    </div>
  );
}
