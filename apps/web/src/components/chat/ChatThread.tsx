'use client';

/**
 * Active conversation pane — ties together the turn list, the
 * live-streaming assistant response, and the composer.
 *
 * Prior turns are rendered from server-loaded props; new turns stream
 * via the SSE route. After a stream ends we call `router.refresh()`
 * so the Server Component re-fetches the canonical list.
 */

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Composer } from './Composer';
import { StreamingMessage } from './StreamingMessage';
import { ToolCard, type ToolCallDisplay } from './ToolCard';

import type { ConversationTurnDisplayRow } from '@/lib/chat/loadConversations';
import type { StreamEvent } from '@/lib/chat/streamClient';

interface ChatThreadProps {
  conversationId: string;
  initialTurns: ConversationTurnDisplayRow[];
}

function renderTurnBody(body: string): React.ReactElement {
  // Lightweight rendering: split on [node:uuid] / [episode:uuid] so
  // citations can be styled without a full markdown renderer.
  const parts = body.split(/(\[(?:node|episode):[0-9a-f-]{36}\])/i);
  return (
    <span>
      {parts.map((part, i) => {
        const m = /^\[(node|episode):([0-9a-f-]{36})\]$/i.exec(part);
        if (m) {
          const type = m[1]?.toLowerCase() as 'node' | 'episode';
          const id = m[2]!;
          const label = id.slice(0, 8);
          return (
            <span
              key={`${i}-${id}`}
              className="mx-0.5 inline-flex items-center rounded-sm border border-border bg-surface-muted px-1 text-[11px] font-medium text-fg-muted"
            >
              <span className="mr-1 text-[9px] uppercase">{type}</span>
              {label}
            </span>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}

export function ChatThread({ conversationId, initialTurns }: ChatThreadProps) {
  const router = useRouter();
  const [activeStream, setActiveStream] = React.useState<AsyncIterable<StreamEvent> | null>(null);
  const [streamKey, setStreamKey] = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [initialTurns, activeStream]);

  function handleStreamStart(events: AsyncIterable<StreamEvent>) {
    setActiveStream(events);
    setStreamKey((k) => k + 1);
  }

  function handleFinal() {
    // Let the router fetch the canonical turn list.
    setTimeout(() => {
      setActiveStream(null);
      router.refresh();
    }, 100);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {initialTurns.length === 0 && !activeStream ? (
          <div className="rounded-md border border-dashed border-border bg-surface p-6 text-center text-sm text-fg-muted">
            Start by asking about schedule, money, food, or someone in the household.
          </div>
        ) : null}
        {initialTurns.map((turn) => {
          const role = turn.role;
          const isAssistant = role === 'assistant';
          const toolCalls = Array.isArray(turn.tool_calls)
            ? (turn.tool_calls as ToolCallDisplay[])
            : [];
          return (
            <div
              key={turn.id}
              className={
                isAssistant
                  ? 'rounded-md border border-border bg-surface p-4'
                  : 'rounded-md border border-border bg-surface/60 p-4'
              }
            >
              <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-fg-muted">
                <span className="font-mono">
                  {isAssistant ? 'assistant' : (turn.author_display_name ?? role)}
                </span>
                <time dateTime={turn.created_at}>
                  {new Date(turn.created_at).toLocaleTimeString()}
                </time>
                {turn.model ? <span className="font-mono text-[10px]">{turn.model}</span> : null}
              </div>
              {isAssistant && toolCalls.length > 0
                ? toolCalls.map((c) => <ToolCard key={c.id} call={c} />)
                : null}
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {renderTurnBody(turn.body_md)}
              </div>
            </div>
          );
        })}
        {activeStream ? (
          <StreamingMessage key={streamKey} events={activeStream} onFinal={handleFinal} />
        ) : null}
      </div>
      <div className="border-t border-border p-3">
        <Composer conversationId={conversationId} onStreamStart={handleStreamStart} />
      </div>
    </div>
  );
}
