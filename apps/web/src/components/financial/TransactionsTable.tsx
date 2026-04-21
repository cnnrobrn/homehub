/**
 * `<TransactionsTable />` — server-rendered ledger table.
 *
 * Columns: date, merchant, category, account, amount, source badge,
 * member (when member_id is set). Ambiguous-match rows get a warn pill
 * with a tooltip listing candidate transaction ids. Shadowed rows are
 * filtered out by the caller unless `?includeShadowed=1` is set.
 *
 * The table is a Server Component — no state, no interactivity. The
 * filter bar on top is a separate client island (`<TransactionsFilterBar />`).
 */

import { formatMoney, type Cents } from '@homehub/shared';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import type { TransactionRow } from '@/lib/financial';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export interface TransactionsTableProps {
  rows: TransactionRow[];
  memberNameById?: Record<string, string>;
  /**
   * Optional cursor for "next page" link; computed from the last row
   * by the caller.
   */
  nextHref?: string | undefined;
}

const SOURCE_LABEL: Record<string, string> = {
  ynab: 'YNAB',
  email_receipt: 'Email',
  plaid: 'Plaid',
  monarch: 'Monarch',
  manual: 'Manual',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TransactionsTable({ rows, memberNameById = {}, nextHref }: TransactionsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
        No transactions match these filters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg/60 text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2">
                Date
              </th>
              <th scope="col" className="px-3 py-2">
                Merchant
              </th>
              <th scope="col" className="px-3 py-2">
                Category
              </th>
              <th scope="col" className="px-3 py-2">
                Account
              </th>
              <th scope="col" className="px-3 py-2">
                Source
              </th>
              <th scope="col" className="px-3 py-2">
                Member
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isAmbiguous = row.status === 'ambiguous_match';
              const isShadowed = row.status === 'shadowed';
              const candidateIds = Array.isArray(row.metadata['candidate_transaction_ids'])
                ? (row.metadata['candidate_transaction_ids'] as unknown[]).filter(
                    (v): v is string => typeof v === 'string',
                  )
                : [];
              return (
                <tr
                  key={row.id}
                  className={cn(
                    'border-t border-border align-top',
                    isShadowed && 'opacity-60',
                    isAmbiguous && 'bg-warn/5',
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-fg-muted">
                    {formatDate(row.occurredAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-fg">
                        {row.merchantRaw ?? 'Unknown merchant'}
                      </span>
                      {isAmbiguous ? (
                        <span
                          className="inline-flex w-fit items-center gap-1 rounded-sm bg-warn/20 px-1.5 py-0.5 text-[11px] font-medium text-warn"
                          title={
                            candidateIds.length > 0
                              ? `Possible duplicate of: ${candidateIds.join(', ')}`
                              : 'Possible duplicate'
                          }
                        >
                          <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                          Possible duplicate
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{row.category ?? '—'}</td>
                  <td className="px-3 py-2 text-fg-muted">
                    {row.accountName ? (
                      <Link
                        href={`/financial/transactions?accountId=${row.accountId}` as never}
                        className="hover:underline"
                      >
                        {row.accountName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[11px]">
                      {SOURCE_LABEL[row.source] ?? row.source}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {row.memberId ? (memberNameById[row.memberId] ?? 'Member') : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-fg">
                    {formatMoney(row.amountCents as unknown as Cents, row.currency || 'USD')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {nextHref ? (
        <div className="flex justify-end">
          <Link
            href={nextHref as never}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg-muted hover:bg-bg/50 hover:text-fg"
          >
            Load older
          </Link>
        </div>
      ) : null}
    </div>
  );
}
