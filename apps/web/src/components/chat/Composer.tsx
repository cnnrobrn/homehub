'use client';

/**
 * Message composer.
 *
 * Visual direction follows the V2 Indie "ask" composer — a warm card
 * with a borderless textarea, a mono "only you and the house see
 * this" hint, a ⏎ keyboard badge, and an ink circle submit button.
 *
 * Behavior:
 *   1. Captures the input.
 *   2. Calls the stream helper (POST /api/chat/stream).
 *   3. Hands the async iterable to the parent for rendering.
 *
 * Slash-command parsing is deliberately minimal:
 *   - `/remember <text>` → appends marker so the agent calls
 *     `remember_fact` directly.
 *   - `/forget` → marker for the agent.
 *   - `/summarize <topic>` → marker; the agent routes to deep
 *     retrieval.
 * For v1 the parsing is a lightweight pass-through; the model still
 * chooses tools. This keeps the surface reviewable.
 */

import * as React from 'react';

import { Kbd } from '@/components/design-system';
import { postChatStream, type StreamEvent } from '@/lib/chat/streamClient';
import { cn } from '@/lib/cn';

interface ComposerProps {
  conversationId: string;
  onStreamStart: (events: AsyncIterable<StreamEvent>) => void;
  onFinal?: () => void;
  placeholder?: string;
  /** Optional value to seed the textarea (e.g. a tapped suggestion pill). */
  prefill?: string | undefined;
  /** Invoked once the prefill has been applied; lets the parent clear it. */
  onPrefillConsumed?: () => void;
}

export function Composer({
  conversationId,
  onStreamStart,
  onFinal,
  placeholder,
  prefill,
  onPrefillConsumed,
}: ComposerProps) {
  const [value, setValue] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (prefill && prefill !== value) {
      setValue(prefill);
      // Focus so the member can edit or hit enter immediately.
      textareaRef.current?.focus();
      if (onPrefillConsumed) onPrefillConsumed();
    }
    // Only react to new `prefill` values — internal edits to `value`
    // must not re-trigger this effect or they'd reset user typing.
  }, [prefill]);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setValue('');
    const controller = new AbortController();
    abortRef.current = controller;
    // Build a generator that both yields to the parent AND watches for
    // the final event so we can reset the submitting state.
    const upstream = postChatStream({
      conversationId,
      message: trimmed,
      signal: controller.signal,
    });
    async function* wrap(): AsyncGenerator<StreamEvent, void, void> {
      try {
        for await (const ev of upstream) {
          yield ev;
          if (ev.type === 'final' || ev.type === 'error') {
            setSubmitting(false);
            if (onFinal) onFinal();
          }
        }
      } finally {
        setSubmitting(false);
      }
    }
    onStreamStart(wrap());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  const canSubmit = !submitting && value.trim().length > 0;

  return (
    <form
      className={cn(
        'rounded-[6px] border bg-surface px-4 pt-3 pb-2.5 shadow-card transition-colors',
        focused ? 'border-fg/30' : 'border-border',
      )}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={textareaRef}
        aria-label="Message composer"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? 'ask about the household, or just think out loud…'}
        rows={2}
        className="w-full resize-none border-0 bg-transparent p-0 text-[14px] leading-[1.5] text-fg outline-none placeholder:text-fg-muted disabled:opacity-60"
        disabled={submitting}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <span className="font-mono text-[10.5px] tracking-[0.04em] text-fg-muted">
          only you and the house see this
        </span>
        <div className="flex-1" />
        <Kbd muted>⏎</Kbd>
        <button
          type="submit"
          aria-label="Send message"
          disabled={!canSubmit}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-full bg-fg text-bg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            !canSubmit ? 'opacity-40' : 'hover:bg-fg/90',
          )}
        >
          <span aria-hidden="true" className="text-[14px] leading-none">
            ↑
          </span>
        </button>
      </div>
    </form>
  );
}
