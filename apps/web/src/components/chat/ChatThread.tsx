'use client';

/**
 * Active conversation pane — ties together the turn list, the
 * live-streaming assistant response, and the composer.
 *
 * Visual language follows the V2 Indie "ask" view:
 *   - user turns as right-aligned ink bubbles
 *   - assistant turns as a left-gutter avatar + plain-prose block
 *   - day/time dividers as centered mono middot stamps
 *   - a calm empty state with suggestion pills so the first screen
 *     does not feel blank
 *
 * Streaming via SSE, server actions, and `router.refresh()` behavior
 * are preserved verbatim — this file only restyles the JSX layer.
 */

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Composer } from './Composer';
import { StreamingMessage, type StreamingMessageOutcome } from './StreamingMessage';
import { ToolCard, type ToolCallDisplay } from './ToolCard';

import type { ConversationTurnDisplayRow } from '@/lib/chat/loadConversations';
import type { StreamEvent } from '@/lib/chat/streamClient';

import { HomeHubMark, PillPrompt } from '@/components/design-system';
import { ASSISTANT_NAME } from '@/lib/assistant';
import { cn } from '@/lib/cn';

interface ChatThreadProps {
  conversationId: string;
  initialTurns: ConversationTurnDisplayRow[];
  initialPrefill?: string | undefined;
  initialNowIso: string;
  timeZone: string;
}

const EXAMPLE_PROMPTS: readonly string[] = [
  'what do i owe for the group trip?',
  "what's for dinner tonight?",
  'when did we last see the garcias?',
  "did i already buy mom's gift?",
];

function timeZoneDayNumber(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(byType.get('year'));
  const month = Number(byType.get('month'));
  const day = Number(byType.get('day'));
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function formatTurnTimestamp(iso: string, nowIso: string, timeZone: string): string {
  const d = new Date(iso);
  const deltaDays = timeZoneDayNumber(nowIso, timeZone) - timeZoneDayNumber(iso, timeZone);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  if (deltaDays === 0) return `today · ${time}`;
  if (deltaDays === 1) return `yesterday · ${time}`;
  if (deltaDays < 7)
    return `${d.toLocaleDateString('en-US', { weekday: 'long', timeZone }).toLowerCase()} · ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone }).toLowerCase()} · ${time}`;
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
              className="mx-0.5 inline-flex items-center rounded-[3px] border border-border bg-surface-soft px-1 font-mono text-[10.5px] text-fg-muted"
            >
              <span className="mr-1 text-[9px] uppercase tracking-[0.06em]">{type}</span>
              {label}
            </span>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}

function isMemberTurn(turn: ConversationTurnDisplayRow): boolean {
  return turn.role !== 'assistant';
}

function optimisticTurnId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `optimistic-${random}`;
}

function withoutPersistedOptimisticTurns(
  optimisticTurns: ConversationTurnDisplayRow[],
  persistedTurns: ConversationTurnDisplayRow[],
): ConversationTurnDisplayRow[] {
  const usedPersistedIndexes = new Set<number>();

  return optimisticTurns.filter((optimistic) => {
    const submittedAt = new Date(optimistic.created_at).getTime();
    const matchIndex = persistedTurns.findIndex((persisted, index) => {
      if (usedPersistedIndexes.has(index)) return false;
      // Roles must match: a persisted assistant turn does not retire
      // an optimistic member turn (and vice versa).
      if (isMemberTurn(persisted) !== isMemberTurn(optimistic)) return false;
      if (persisted.body_md !== optimistic.body_md) return false;

      const persistedAt = new Date(persisted.created_at).getTime();
      // Clocks can drift slightly between the browser and database, but
      // an OLDER matching turn must not erase a newly submitted
      // optimistic one (e.g., if the user sent the same message hours
      // ago and we accidentally match against that historical row).
      // The persisted timestamp is allowed to be slightly behind the
      // optimistic timestamp to absorb forward clock skew on the server.
      return persistedAt >= submittedAt - 60_000;
    });

    if (matchIndex === -1) return true;
    usedPersistedIndexes.add(matchIndex);
    return false;
  });
}

export function ChatThread({
  conversationId,
  initialTurns,
  initialPrefill,
  initialNowIso,
  timeZone,
}: ChatThreadProps) {
  const router = useRouter();
  const [activeStream, setActiveStream] = React.useState<AsyncIterable<StreamEvent> | null>(null);
  const [streamKey, setStreamKey] = React.useState(0);
  const [optimisticTurns, setOptimisticTurns] = React.useState<ConversationTurnDisplayRow[]>([]);
  const [prefill, setPrefill] = React.useState<string | undefined>(initialPrefill);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const displayedTurns = React.useMemo(
    () => [...initialTurns, ...withoutPersistedOptimisticTurns(optimisticTurns, initialTurns)],
    [initialTurns, optimisticTurns],
  );

  const scrollToBottom = React.useCallback(() => {
    const scroll = () => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scroll);
    } else {
      setTimeout(scroll, 0);
    }
  }, []);

  React.useEffect(() => {
    scrollToBottom();
  }, [activeStream, displayedTurns, scrollToBottom]);

  React.useEffect(() => {
    setOptimisticTurns((current) => withoutPersistedOptimisticTurns(current, initialTurns));
  }, [initialTurns]);

  function handleStreamStart(events: AsyncIterable<StreamEvent>, submittedMessage: string) {
    const now = new Date().toISOString();
    setOptimisticTurns((current) => [
      ...current,
      {
        id: optimisticTurnId(),
        role: 'member',
        body_md: submittedMessage,
        author_member_id: null,
        author_display_name: null,
        created_at: now,
        tool_calls: [],
        citations: [],
        model: null,
      },
    ]);
    setActiveStream(events);
    setStreamKey((k) => k + 1);
  }

  const handleStreamUpdate = React.useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const handleStreamComplete = React.useCallback(
    (outcome: StreamingMessageOutcome) => {
      if (outcome.kind === 'error') {
        // Leave the streaming view mounted so the user can read the
        // error in place. They'll either retry (which mounts a fresh
        // StreamingMessage via the streamKey) or navigate away.
        return;
      }
      // Promote the assistant body into optimistic state BEFORE we tear
      // down the streaming view. Without this, there's a visible gap
      // between activeStream becoming null and router.refresh()
      // returning the persisted turn — the assistant's reply briefly
      // disappears from screen, which is exactly what users perceive as
      // "buggy". Once the canonical turn arrives in initialTurns, the
      // reconciliation effect below removes the optimistic copy.
      const body = outcome.assistantBody.trim();
      if (body.length > 0) {
        setOptimisticTurns((current) => [
          ...current,
          {
            id: optimisticTurnId(),
            role: 'assistant',
            body_md: outcome.assistantBody,
            author_member_id: null,
            author_display_name: null,
            created_at: new Date().toISOString(),
            tool_calls: outcome.toolCalls,
            citations: [],
            model: outcome.model,
          },
        ]);
      }
      setActiveStream(null);
      router.refresh();
    },
    [router],
  );

  const isEmpty = displayedTurns.length === 0 && !activeStream;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-10 sm:px-12">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
          {isEmpty ? <EmptyAskState /> : null}

          {displayedTurns.map((turn, i) => {
            const role = turn.role;
            const isAssistant = role === 'assistant';
            const toolCalls = Array.isArray(turn.tool_calls)
              ? (turn.tool_calls as ToolCallDisplay[])
              : [];

            const prev = i > 0 ? displayedTurns[i - 1] : null;
            const showStamp =
              !prev ||
              new Date(turn.created_at).getTime() - new Date(prev.created_at).getTime() >
                15 * 60 * 1000;

            return (
              <React.Fragment key={turn.id}>
                {showStamp ? (
                  <TimestampDivider
                    iso={turn.created_at}
                    nowIso={initialNowIso}
                    timeZone={timeZone}
                  />
                ) : null}
                {isAssistant ? (
                  <BotTurn
                    body={renderTurnBody(turn.body_md)}
                    model={turn.model}
                    toolCalls={toolCalls}
                  />
                ) : (
                  <UserTurn body={renderTurnBody(turn.body_md)} />
                )}
              </React.Fragment>
            );
          })}

          {activeStream ? (
            <StreamingMessage
              key={streamKey}
              events={activeStream}
              onComplete={handleStreamComplete}
              onUpdate={handleStreamUpdate}
            />
          ) : null}
        </div>
      </div>

      <div className="px-6 pt-3 pb-7 sm:px-12">
        <div className="mx-auto w-full max-w-[640px]">
          <Composer
            conversationId={conversationId}
            onStreamStart={handleStreamStart}
            prefill={prefill}
            onPrefillConsumed={() => setPrefill(undefined)}
          />
          {isEmpty ? (
            <div className="mx-auto mt-3 flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((q) => (
                <PillPrompt key={q} onClick={() => setPrefill(q)}>
                  {q}
                </PillPrompt>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Empty state ──────────────────────────────────────────────── */

function EmptyAskState() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-fg">
        <HomeHubMark size={16} />
      </div>
      <h1 className="m-0 max-w-[460px] text-[22px] font-semibold leading-[1.25] tracking-[-0.02em]">
        {ASSISTANT_NAME} is ready.
      </h1>
      <p className="m-0 max-w-[440px] text-[14px] leading-[1.55] text-fg-muted">
        Ask about schedule, money, food, or someone you haven&apos;t seen in a while. Only you and
        the house see this.
      </p>
    </div>
  );
}

/* ── User turn (right-aligned ink bubble) ─────────────────────── */

function UserTurn({ body }: { body: React.ReactElement }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          'max-w-[82%] whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-fg px-[14px] py-[10px]',
          'text-[14px] leading-[1.5] text-bg',
        )}
      >
        {body}
      </div>
    </div>
  );
}

/* ── Assistant turn (left gutter + avatar) ────────────────────── */

function BotTurn({
  body,
  toolCalls,
  model,
}: {
  body: React.ReactElement;
  toolCalls: ToolCallDisplay[];
  model: string | null;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg">
        <HomeHubMark size={12} />
      </div>
      <div className="min-w-0 flex-1">
        {toolCalls.length > 0 ? toolCalls.map((c) => <ToolCard key={c.id} call={c} />) : null}
        <div className="whitespace-pre-wrap text-[14.5px] leading-[1.6] text-fg">{body}</div>
        {model ? (
          <div className="mt-1.5 font-mono text-[10.5px] tracking-[0.04em] text-fg-muted">
            via {model}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Middot date divider ──────────────────────────────────────── */

function TimestampDivider({
  iso,
  nowIso,
  timeZone,
}: {
  iso: string;
  nowIso: string;
  timeZone: string;
}) {
  return (
    <div className="flex justify-center">
      <span className="font-mono text-[10.5px] tracking-[0.06em] text-fg-muted">
        {formatTurnTimestamp(iso, nowIso, timeZone)}
      </span>
    </div>
  );
}
