/**
 * `<SubscriptionRow />` — one row on `/financial/subscriptions`.
 *
 * Server Component. Renders canonical name, cadence, latest price,
 * match count, and last/next charge. Action buttons (propose-cancel,
 * confirm-is-subscription) are small client islands so the table stays
 * server-rendered.
 */

import { formatMoney, type Cents } from '@homehub/shared';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';

import { ProposeCancelSubscriptionButton } from './ProposeCancelSubscriptionButton';
import { SubscriptionConfirmButton } from './SubscriptionConfirmButton';

import type { SubscriptionRow as SubscriptionRowType } from '@/lib/financial';

import { Badge } from '@/components/ui/badge';

export interface SubscriptionRowProps {
  subscription: SubscriptionRowType;
}

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  unknown: 'Unknown cadence',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SubscriptionRow({ subscription }: SubscriptionRowProps) {
  const price =
    subscription.priceCents === null
      ? null
      : formatMoney(subscription.priceCents as Cents, subscription.currency || 'USD');

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">{subscription.canonicalName}</span>
          <Badge variant="outline" className="text-[11px]">
            {CADENCE_LABEL[subscription.cadence]}
          </Badge>
          {subscription.needsReview ? (
            <span
              className="inline-flex items-center gap-1 rounded-sm bg-warn/20 px-1.5 py-0.5 text-[11px] font-medium text-warn"
              role="status"
            >
              <AlertTriangle aria-hidden="true" className="h-3 w-3" />
              Needs review
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
          <span>{price ?? 'price unknown'}</span>
          <span>·</span>
          <span>
            {subscription.matchCount} {subscription.matchCount === 1 ? 'charge' : 'charges'} matched
          </span>
          <span>·</span>
          <span>last {formatDate(subscription.lastChargedAt)}</span>
          {subscription.nextChargeAt ? (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <RefreshCw aria-hidden="true" className="h-3 w-3" />
                next {formatDate(subscription.nextChargeAt)}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/memory/subscription/${subscription.id}` as never}
          className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs text-fg-muted hover:bg-bg/70 hover:text-fg"
        >
          View on graph
        </Link>
        {subscription.needsReview ? (
          <SubscriptionConfirmButton subscriptionNodeId={subscription.id} />
        ) : null}
        <ProposeCancelSubscriptionButton
          subscriptionNodeId={subscription.id}
          canonicalName={subscription.canonicalName}
        />
      </div>
    </article>
  );
}
