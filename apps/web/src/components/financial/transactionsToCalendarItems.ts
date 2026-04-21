/**
 * Transform `TransactionRow[]` + `SubscriptionRow[]` into
 * `CalendarEventRow[]` for rendering inside the unified calendar
 * primitives (`WeekGrid` / `MonthGrid`).
 *
 * The calendar components only know about `CalendarEventRow`; we
 * synthesize stable ids + point-in-time events (`endsAt = null`) for
 * each transaction charge and subscription next-charge projection.
 */

import { formatMoney, type Cents } from '@homehub/shared';

import type { CalendarEventRow } from '@/lib/events/listEvents';
import type { SubscriptionRow, TransactionRow } from '@/lib/financial';

export interface ToCalendarOpts {
  from: Date;
  to: Date;
  householdId: string;
}

function inRange(iso: string, from: Date, to: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

export function transactionsToCalendarItems(
  transactions: readonly TransactionRow[],
  subscriptions: readonly SubscriptionRow[],
  opts: ToCalendarOpts,
): CalendarEventRow[] {
  const items: CalendarEventRow[] = [];

  for (const tx of transactions) {
    if (tx.status === 'shadowed') continue;
    if (!inRange(tx.occurredAt, opts.from, opts.to)) continue;
    const amount = formatMoney(tx.amountCents as Cents, tx.currency || 'USD');
    items.push({
      id: `tx-${tx.id}`,
      householdId: opts.householdId,
      segment: 'financial',
      kind: 'transaction',
      title: `${tx.merchantRaw ?? 'Transaction'} — ${amount}`,
      startsAt: tx.occurredAt,
      endsAt: null,
      allDay: false,
      location: tx.accountName,
      provider: tx.source,
      ownerMemberId: tx.memberId,
      metadata: { transactionId: tx.id, category: tx.category },
    });
  }

  for (const sub of subscriptions) {
    if (!sub.nextChargeAt) continue;
    if (!inRange(sub.nextChargeAt, opts.from, opts.to)) continue;
    const price =
      sub.priceCents === null
        ? ''
        : ` — ${formatMoney(sub.priceCents as Cents, sub.currency || 'USD')}`;
    items.push({
      id: `sub-${sub.id}-${sub.nextChargeAt}`,
      householdId: opts.householdId,
      segment: 'financial',
      kind: 'subscription_projection',
      title: `${sub.canonicalName}${price}`,
      startsAt: sub.nextChargeAt,
      endsAt: null,
      allDay: true,
      location: null,
      provider: null,
      ownerMemberId: null,
      metadata: { subscriptionNodeId: sub.id, cadence: sub.cadence, projected: true },
    });
  }

  return items;
}
