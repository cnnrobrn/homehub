/**
 * `EmailConnectDialog` — Gmail connect confirmation + privacy preview.
 *
 * Client island. Opens BEFORE the OAuth redirect. The member:
 *   1. Picks which categories (receipt / reservation / bill / invite /
 *      shipping) HomeHub is allowed to label and ingest.
 *   2. Sees the actual Gmail search filter we'll apply — no hand-wavy
 *      "we might peek at your email" copy. The preview text comes from
 *      `buildGmailQuery` so the dialog and worker can never drift.
 *   3. Clicks "Continue to Google" to be redirected to
 *      `/api/integrations/connect?provider=google-mail&categories=…`.
 *      The route validates the list again on the server side.
 *
 * Storage of the opt-ins is handled server-side via the Nango session
 * tags and the `/webhooks/nango` handler in `apps/workers/webhook-ingest`.
 * Nothing persists from this dialog until the member actually confirms.
 */

'use client';

import {
  ALL_EMAIL_CATEGORIES,
  CATEGORY_FILTERS,
  buildGmailQuery,
  describeCategories,
  type EmailCategory,
} from '@homehub/providers-email/client';
import { Mail, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const INITIAL_CATEGORIES: readonly EmailCategory[] = ALL_EMAIL_CATEGORIES;

export function EmailConnectDialog() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<EmailCategory>>(() => new Set(INITIAL_CATEGORIES));

  const orderedSelected = useMemo(
    () => ALL_EMAIL_CATEGORIES.filter((c) => selected.has(c)),
    [selected],
  );
  const queryPreview = useMemo(
    () => buildGmailQuery({ categories: orderedSelected, withinDays: 180 }),
    [orderedSelected],
  );
  const descriptions = useMemo(() => describeCategories(orderedSelected), [orderedSelected]);

  const canContinue = orderedSelected.length > 0;
  const continueHref = canContinue
    ? `/api/integrations/connect?provider=google-mail&categories=${encodeURIComponent(orderedSelected.join(','))}`
    : undefined;

  function toggle(category: EmailCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Mail className="mr-2 h-4 w-4" aria-hidden="true" /> Connect Gmail
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
            Connect Gmail — choose what HomeHub reads
          </DialogTitle>
          <DialogDescription>
            HomeHub only scans emails matching these filters. Everything else stays untouched. You
            can change these anytime in Settings.
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="email-categories-heading" className="flex flex-col gap-3">
          <h3 id="email-categories-heading" className="text-sm font-medium text-fg">
            Categories
          </h3>
          <ul className="flex flex-col gap-2">
            {ALL_EMAIL_CATEGORIES.map((category) => {
              const def = CATEGORY_FILTERS[category];
              const inputId = `email-cat-${category}`;
              return (
                <li
                  key={category}
                  className="flex items-start gap-3 rounded-md border border-border bg-surface/50 p-3"
                >
                  <Checkbox
                    id={inputId}
                    checked={selected.has(category)}
                    onCheckedChange={() => toggle(category)}
                    aria-describedby={`${inputId}-desc`}
                  />
                  <div className="flex flex-col">
                    <Label htmlFor={inputId} className="text-sm font-medium">
                      {def.description}
                    </Label>
                    <span id={`${inputId}-desc`} className="text-xs text-fg-muted">
                      Category: <code className="font-mono">{category}</code>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="email-preview-heading" className="flex flex-col gap-2">
          <h3 id="email-preview-heading" className="text-sm font-medium text-fg">
            Gmail filter we will apply
          </h3>
          {queryPreview ? (
            <>
              <pre className="overflow-x-auto rounded-md border border-border bg-bg p-3 text-xs leading-relaxed text-fg-muted">
                <code>{queryPreview}</code>
              </pre>
              <p className="text-xs text-fg-muted" aria-live="polite">
                {descriptions.length > 0 ? `HomeHub will ingest: ${descriptions.join(' · ')}.` : ''}
              </p>
            </>
          ) : (
            <p className="text-xs text-destructive" aria-live="polite">
              Select at least one category to continue.
            </p>
          )}
        </section>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} type="button">
            Cancel
          </Button>
          <Button asChild disabled={!canContinue}>
            {continueHref ? (
              <a href={continueHref}>Continue to Google</a>
            ) : (
              <span aria-disabled="true">Continue to Google</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
