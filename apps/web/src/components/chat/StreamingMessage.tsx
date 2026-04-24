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

export type StreamingMessageOutcome =
  | {
      kind: 'final';
      assistantBody: string;
      toolCalls: ToolCallDisplay[];
      model: string | null;
    }
  | { kind: 'error'; message: string };

interface StreamingMessageProps {
  events: AsyncIterable<StreamEvent>;
  /**
   * Called once the stream terminates. The outcome tells the parent
   * whether to optimistically persist the assistant turn (final) or to
   * leave the error message visible until the user retries (error).
   */
  onComplete?: (outcome: StreamingMessageOutcome) => void;
  /** Called after visible stream state changes; used by parents to keep the latest turn in view. */
  onUpdate?: () => void;
}

interface ToolCallState {
  call: ToolCallDisplay;
  streaming: boolean;
}

export function StreamingMessage({ events, onComplete, onUpdate }: StreamingMessageProps) {
  const [text, setText] = React.useState('');
  const [calls, setCalls] = React.useState<ToolCallState[]>([]);
  const [suggestions, setSuggestions] = React.useState<
    Array<{ callId: string; tool: string; summary: string; preview: unknown }>
  >([]);
  const [thinkingText, setThinkingText] = React.useState('');
  const [thinkingStatus, setThinkingStatus] = React.useState('');
  const [thinking, setThinking] = React.useState(true);
  const [done, setDone] = React.useState(false);
  const onCompleteRef = React.useRef(onComplete);
  const onUpdateRef = React.useRef(onUpdate);

  React.useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  React.useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  React.useEffect(() => {
    let cancelled = false;
    let finished = false;
    // Keep refs to the latest streamed body and tool calls so we can
    // forward them to the parent on completion. The state setters are
    // async, so we can't read fresh state inside finish().
    let bodyRef = '';
    let callsRef: ToolCallState[] = [];
    let modelRef: string | null = null;
    function finish(outcome: StreamingMessageOutcome) {
      if (finished) return;
      finished = true;
      setThinking(false);
      setDone(true);
      if (onCompleteRef.current) onCompleteRef.current(outcome);
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
            bodyRef += ev.delta;
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
            callsRef = [
              ...callsRef,
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
            ];
            setCalls(callsRef);
            break;
          case 'tool_call_done':
            callsRef = callsRef.map((c) =>
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
            );
            setCalls(callsRef);
            break;
          case 'tool_call_error':
            callsRef = callsRef.map((c) =>
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
            );
            setCalls(callsRef);
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
          case 'final': {
            const assistantBody = ev.assistantBody || bodyRef;
            modelRef = ev.model || modelRef;
            if (ev.assistantBody) {
              bodyRef = ev.assistantBody;
              setText(ev.assistantBody);
            }
            finish({
              kind: 'final',
              assistantBody,
              toolCalls: callsRef.map((c) => c.call),
              model: modelRef,
            });
            break;
          }
          case 'error':
            setText((prev) => (prev ? `${prev}\n\n_${ev.message}_` : `_${ev.message}_`));
            finish({ kind: 'error', message: ev.message });
            break;
        }
      }
      if (!cancelled) {
        // Stream EOF without a terminal event. streamClient now
        // synthesizes an error event in this case, but defend in depth
        // in case a future transport change forgets.
        finish({
          kind: 'error',
          message: 'stream ended without a final event',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [events]);

  React.useEffect(() => {
    if (onUpdateRef.current) onUpdateRef.current();
  }, [text, calls, suggestions, thinkingText, thinkingStatus, thinking, done]);

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
