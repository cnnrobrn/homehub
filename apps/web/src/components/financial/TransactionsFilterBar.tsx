/**
 * `<TransactionsFilterBar />` — URL-driven filter controls for the
 * ledger.
 *
 * Client Component. Reads filters from the URL (via `useSearchParams`)
 * and writes them back to the URL as the member types/selects. The
 * server page re-reads the URL on every navigation, which is the
 * source of truth for what the table shows — we never store filter
 * state in React state alone.
 *
 * Filters covered: date range, account, member, source, search text,
 * include shadowed toggle.
 */

'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface TransactionsFilterBarProps {
  accounts: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  sources: string[];
}

const SOURCE_LABEL: Record<string, string> = {
  ynab: 'YNAB',
  email_receipt: 'Email receipts',
  plaid: 'Plaid',
  monarch: 'Monarch',
  manual: 'Manual',
};

export function TransactionsFilterBar({ accounts, members, sources }: TransactionsFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    // Reset cursor whenever filters change.
    params.delete('before');
    params.delete('beforeAt');
    if (value === null || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const href = `${pathname}?${params.toString()}`;
    startTransition(() => {
      router.push(href as never);
    });
  }

  const from = searchParams?.get('from') ?? '';
  const to = searchParams?.get('to') ?? '';
  const accountId = searchParams?.get('accountId') ?? '';
  const memberId = searchParams?.get('memberId') ?? '';
  const source = searchParams?.get('source') ?? '';
  const search = searchParams?.get('search') ?? '';
  const includeShadowed = searchParams?.get('includeShadowed') === '1';

  return (
    <fieldset
      aria-label="Filter transactions"
      className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <legend className="sr-only">Filters</legend>
      <div className="flex flex-col gap-1">
        <Label htmlFor="tx-from" className="text-xs text-fg-muted">
          From
        </Label>
        <Input
          id="tx-from"
          type="date"
          defaultValue={from}
          onChange={(e) => setParam('from', e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="tx-to" className="text-xs text-fg-muted">
          To
        </Label>
        <Input
          id="tx-to"
          type="date"
          defaultValue={to}
          onChange={(e) => setParam('to', e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="tx-account" className="text-xs text-fg-muted">
          Account
        </Label>
        <select
          id="tx-account"
          defaultValue={accountId}
          onChange={(e) => setParam('accountId', e.target.value)}
          className="h-9 rounded-md border border-border bg-bg px-2 text-sm"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="tx-member" className="text-xs text-fg-muted">
          Member
        </Label>
        <select
          id="tx-member"
          defaultValue={memberId}
          onChange={(e) => setParam('memberId', e.target.value)}
          className="h-9 rounded-md border border-border bg-bg px-2 text-sm"
        >
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="tx-source" className="text-xs text-fg-muted">
          Source
        </Label>
        <select
          id="tx-source"
          defaultValue={source}
          onChange={(e) => setParam('source', e.target.value)}
          className="h-9 rounded-md border border-border bg-bg px-2 text-sm"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="tx-search" className="text-xs text-fg-muted">
          Search merchant
        </Label>
        <Input
          id="tx-search"
          type="search"
          defaultValue={search}
          placeholder="e.g. Netflix"
          onChange={(e) => setParam('search', e.target.value)}
        />
      </div>
      <div className="flex items-end gap-2">
        <Checkbox
          id="tx-show-shadowed"
          checked={includeShadowed}
          onCheckedChange={(value) => setParam('includeShadowed', value === true ? '1' : null)}
        />
        <Label htmlFor="tx-show-shadowed" className="cursor-pointer text-xs text-fg-muted">
          Show shadowed rows
        </Label>
      </div>
    </fieldset>
  );
}
