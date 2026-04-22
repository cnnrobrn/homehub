'use client';

/**
 * Sidebar "Ask about anything…" trigger.
 *
 * Fires a custom `hh:open-command-k` event that `CommandKLauncher`
 * (rendered in the top bar) listens for. Keeping the launcher's state
 * in one place means ⌘K from anywhere — keyboard shortcut, sidebar
 * button, top-bar button — funnels through the same dialog.
 */

import { Kbd } from '@/components/design-system';

function IconSearch() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <circle cx={6} cy={6} r={4} />
      <path d="M9 9l3 3" strokeLinecap="round" />
    </svg>
  );
}

export function OpenCommandK() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('hh:open-command-k'))}
      aria-label="Ask about anything"
      className="mb-4 flex items-center gap-2 rounded-[4px] border border-border bg-surface px-2.5 py-2 text-[12.5px] text-fg-muted transition-colors hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-soft"
    >
      <IconSearch />
      <span className="flex-1 text-left">Ask about anything…</span>
      <Kbd muted>⌘</Kbd>
      <Kbd muted>K</Kbd>
    </button>
  );
}
