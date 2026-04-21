/**
 * Notes editor for `mem.node.manual_notes_md`.
 *
 * Client island. Saves on blur + on Cmd+Enter. A visible status
 * chip indicates unsaved/saving/saved state.
 */

'use client';

import { useState, useTransition } from 'react';

import { updateManualNotesAction } from '@/app/actions/memory';
import { toast } from '@/components/ui/use-toast';

export interface ManualNotesEditorProps {
  nodeId: string;
  initialMarkdown: string | null;
}

export function ManualNotesEditor({ nodeId, initialMarkdown }: ManualNotesEditorProps) {
  const [value, setValue] = useState(initialMarkdown ?? '');
  const [savedValue, setSavedValue] = useState(initialMarkdown ?? '');
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (value === savedValue) return;
    startTransition(async () => {
      const res = await updateManualNotesAction({ nodeId, markdown: value });
      if (!res.ok) {
        toast({ title: 'Save failed', description: res.error.message });
        return;
      }
      setSavedValue(value);
    });
  };

  const status = pending ? 'Saving…' : value === savedValue ? 'Saved' : 'Unsaved';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={`notes-${nodeId}`} className="text-sm font-medium text-fg">
          Manual notes
        </label>
        <span className="text-xs text-fg-muted" role="status" aria-live="polite">
          {status}
        </span>
      </div>
      <textarea
        id={`notes-${nodeId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
        className="min-h-[140px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        placeholder="Free-form notes preserved across regeneration."
        maxLength={16_000}
      />
      <p className="text-xs text-fg-muted">
        These notes are kept across document regenerations. Auto-saves on blur; press ⌘↵ to save
        immediately.
      </p>
    </div>
  );
}
