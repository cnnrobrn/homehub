/**
 * `<AlertEvidenceDrawer />` — right-side drawer showing the entities
 * referenced by an alert's `context` JSON.
 *
 * The M5-B alerts worker embeds the triggering rows in
 * `context.transaction_ids` (array) and/or
 * `context.subscription_node_id`. We render those as deep-links to the
 * ledger and to the memory graph node page respectively, plus a
 * pretty-printed JSON blob for unknown keys.
 */

'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { FinancialAlertRow } from '@/lib/financial';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

export interface AlertEvidenceDrawerProps {
  alert: FinancialAlertRow;
}

function coerceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

export function AlertEvidenceDrawer({ alert }: AlertEvidenceDrawerProps) {
  const [open, setOpen] = useState(false);
  const context = alert.context;
  const transactionIds = coerceIds(context['transaction_ids']);
  const subscriptionNodeId =
    typeof context['subscription_node_id'] === 'string'
      ? (context['subscription_node_id'] as string)
      : null;

  const {
    alert_kind: _ak,
    alert_dedupe_key: _adk,
    transaction_ids: _tx,
    subscription_node_id: _sub,
    ...extraContext
  } = context;
  void _ak;
  void _adk;
  void _tx;
  void _sub;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`alert-evidence-${alert.id}`}>
          View evidence
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex flex-col gap-4 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{alert.title}</SheetTitle>
          <p className="text-sm text-fg-muted">{alert.body}</p>
        </SheetHeader>
        {transactionIds.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Linked transactions
            </h4>
            <ul className="flex flex-col gap-1 text-sm">
              {transactionIds.map((id) => (
                <li key={id}>
                  <Link
                    href={`/financial/transactions?highlight=${id}` as never}
                    className="text-accent hover:underline"
                  >
                    {id}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {subscriptionNodeId ? (
          <section className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Subscription
            </h4>
            <Link
              href={`/memory/subscription/${subscriptionNodeId}` as never}
              className="text-sm text-accent hover:underline"
            >
              View on memory graph
            </Link>
          </section>
        ) : null}
        {Object.keys(extraContext).length > 0 ? (
          <section className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Additional context
            </h4>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-bg p-2 text-xs text-fg-muted">
              {JSON.stringify(extraContext, null, 2)}
            </pre>
          </section>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
