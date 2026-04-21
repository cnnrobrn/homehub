/**
 * `<AccountCard />` — one card per `app.account` row.
 *
 * Server Component. Shows name, kind, balance (formatted via the
 * shared `formatMoney`), last-sync freshness, and a "stale" pill if
 * the account hasn't refreshed in >24h.
 *
 * Clicking the account drills into `/financial/transactions?accountId=…`.
 */

import { formatMoney, type Cents } from '@homehub/shared';
import { CircleDollarSign, CreditCard, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';

import type { AccountRow } from '@/lib/financial';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export interface AccountCardProps {
  account: AccountRow;
}

function iconFor(kind: string) {
  switch (kind) {
    case 'credit_card':
      return CreditCard;
    case 'savings':
      return PiggyBank;
    case 'investment':
      return TrendingUp;
    case 'checking':
      return Wallet;
    default:
      return CircleDollarSign;
  }
}

function humanizeSync(iso: string | null): string {
  if (!iso) return 'never synced';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never synced';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AccountCard({ account }: AccountCardProps) {
  const Icon = iconFor(account.kind);
  const balance =
    account.balanceCents === null
      ? null
      : formatMoney(account.balanceCents as Cents, account.currency || 'USD');
  return (
    <Link
      href={`/financial/transactions?accountId=${account.id}` as never}
      aria-label={`${account.name} — view transactions`}
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors',
        'hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="h-5 w-5 text-fg-muted" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-fg">{account.name}</span>
            <span className="text-xs capitalize text-fg-muted">
              {account.kind.replace(/_/g, ' ')}
              {account.provider ? ` · ${account.provider}` : ''}
            </span>
          </div>
        </div>
        {account.stale ? (
          <Badge variant="outline" className="border-warn text-warn">
            Stale
          </Badge>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xl font-semibold tabular-nums text-fg">{balance ?? '—'}</span>
        <span className="text-xs text-fg-muted">synced {humanizeSync(account.lastSyncedAt)}</span>
      </div>
    </Link>
  );
}
