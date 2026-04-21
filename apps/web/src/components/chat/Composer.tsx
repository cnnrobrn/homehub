'use client';

/**
 * Message composer.
 *
 * On submit:
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

import { SendHorizontal } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { postChatStream, type StreamEvent } from '@/lib/chat/streamClient';

interface ComposerProps {
  conversationId: string;
  onStreamStart: (events: AsyncIterable<StreamEvent>) => void;
  onFinal?: () => void;
  placeholder?: string;
}

export function Composer({ conversationId, onStreamStart, onFinal, placeholder }: ComposerProps) {
  const [value, setValue] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

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

  return (
    <form
      className="flex items-end gap-2 rounded-md border border-border bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Message composer"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Ask HomeHub or press / for commands'}
        rows={2}
        className="min-h-[2.5rem] w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg-muted"
        disabled={submitting}
      />
      <Button
        type="submit"
        size="sm"
        aria-label="Send message"
        disabled={submitting || value.trim().length === 0}
      >
        <SendHorizontal className="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  );
}
