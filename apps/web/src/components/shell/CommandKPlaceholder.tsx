/**
 * ⌘K / Ctrl+K launcher placeholder.
 *
 * Opens a Dialog explaining that chat lands in M3.5. The shortcut
 * registration lives here so the real chat panel can drop in later by
 * swapping this component for the M3.5 `<CommandKLauncher />` in
 * `TopBar.tsx` — everything outside this file is unchanged.
 */

'use client';

import { Command } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function CommandKPlaceholder() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chat is coming in M3.5</DialogTitle>
          <DialogDescription>
            The ⌘K / Ctrl + K launcher will open the HomeHub chat panel from anywhere. Until then,
            try out settings and household management.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
