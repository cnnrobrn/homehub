'use client';

/**
 * ⌘K / Ctrl+K launcher — opens an inline chat panel from anywhere.
 *
 * First-message flow: we lazily create a new conversation (via a
 * server action) on submit and stream the response into the panel.
 * The "Expand" button navigates to the full `/chat/[conversationId]`
 * page so the member can keep the thread going.
 *
 * Accessibility:
 *   - Dialog handles focus trap + escape-to-close.
 *   - The composer gets the initial focus.
 *   - Screen-reader-visible instructions are present for the shortcut.
 */

import { Command, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import type { StreamEvent } from '@/lib/chat/streamClient';

import { createConversationAction } from '@/app/actions/chat';
import { StreamingMessage } from '@/components/chat/StreamingMessage';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface CommandKLauncherProps {
  householdId: string;
}

export function CommandKLauncher({ householdId }: CommandKLauncherProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [stream, setStream] = React.useState<AsyncIterable<StreamEvent> | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId;
    setCreating(true);
    try {
      const res = await createConversationAction({ householdId });
      if (!res.ok) {
        setError(res.error.message);
        return null;
      }
      setConversationId(res.data.conversationId);
      return res.data.conversationId;
    } finally {
      setCreating(false);
    }
  }

  // Lazy-create when the panel opens so a stray ⌘K doesn't create a
  // row — the conversation is only persisted when a first message is
  // on its way.

  function handleExpand() {
    if (conversationId) {
      setOpen(false);
      router.push(`/chat/${conversationId}`);
    }
  }

  // Wrap composer submission: we need to create a conversation first
  // on first send. The inline Composer below accepts a callback that
  // resolves the conversation id + kicks off the stream.
  async function handleSubmit(message: string) {
    const id = await ensureConversation();
    if (!id) return;
    const { postChatStream } = await import('@/lib/chat/streamClient');
    const events = postChatStream({ conversationId: id, message });
    setStream(events);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label="Open command launcher (Ctrl or Command + K)"
        >
          <Command className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">K</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>Ask HomeHub</DialogTitle>
            {conversationId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExpand}
                className="gap-1 text-xs"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Expand
              </Button>
            ) : null}
          </div>
          <DialogDescription>
            Ask a question or give an instruction. Press Enter to send, Esc to close.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-[240px] space-y-3">
          {stream ? (
            <StreamingMessage events={stream} onFinal={() => router.refresh()} />
          ) : (
            <div className="rounded-md border border-dashed border-border bg-surface p-4 text-sm text-fg-muted">
              Your last three turns will appear here once you start a conversation. For now, ask
              anything to begin.
            </div>
          )}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
        </div>
        <InlineComposer onSubmit={handleSubmit} disabled={creating} />
      </DialogContent>
    </Dialog>
  );
}

function InlineComposer({
  onSubmit,
  disabled,
}: {
  onSubmit: (v: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="flex items-end gap-2 rounded-md border border-border bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed || busy) return;
        setBusy(true);
        setValue('');
        onSubmit(trimmed);
        // Reset after a tick so the user can submit again when done.
        setTimeout(() => setBusy(false), 100);
      }}
    >
      <textarea
        aria-label="Message composer"
        rows={2}
        disabled={disabled || busy}
        placeholder="Ask HomeHub…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
          }
        }}
        className="min-h-[2.5rem] w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg-muted"
      />
      <Button type="submit" size="sm" disabled={disabled || busy || value.trim().length === 0}>
        Send
      </Button>
    </form>
  );
}
