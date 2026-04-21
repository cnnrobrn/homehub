/**
 * `/financial/transactions` — read-only ledger.
 *
 * Server-rendered table driven entirely by the URL. Filter bar above
 * the table writes filter state back into `?from=…&to=…&accountId=…
 * &memberId=…&source=…&search=…&includeShadowed=1`, and
 * `?before=<id>&beforeAt=<iso>` powers cursor pagination.
 */

import { listMembersAction } from '@/app/actions/members';
import { FinancialRealtimeRefresher } from '@/components/financial/FinancialRealtimeRefresher';
import { TransactionsFilterBar } from '@/components/financial/TransactionsFilterBar';
import { TransactionsTable } from '@/components/financial/TransactionsTable';
import { getHouseholdContext } from '@/lib/auth/context';
import { listAccounts, listTransactions, type SegmentGrant } from '@/lib/financial';

const PAGE_SIZE = 50;
const KNOWN_SOURCES = ['ynab', 'email_receipt', 'plaid', 'monarch', 'manual'];

function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function toIso(raw: string | undefined, end = false): string | undefined {
  if (!raw) return undefined;
  // Accept `YYYY-MM-DD` (date input) or a full ISO string.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    const [, y, mo, d] = m;
    const date = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      end ? 23 : 0,
      end ? 59 : 0,
      end ? 59 : 0,
      end ? 999 : 0,
    );
    return date.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export interface TransactionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TransactionsPage({ searchParams }: TransactionsPageProps) {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const params = await searchParams;

  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));

  const from = toIso(firstString(params.from), false);
  const to = toIso(firstString(params.to), true);
  const accountId = firstString(params.accountId);
  const memberId = firstString(params.memberId);
  const source = firstString(params.source);
  const search = firstString(params.search);
  const includeShadowed = firstString(params.includeShadowed) === '1';
  const beforeId = firstString(params.before);
  const beforeAt = firstString(params.beforeAt);

  const [transactions, accounts, membersRes] = await Promise.all([
    listTransactions(
      {
        householdId: ctx.household.id,
        from,
        to,
        accountIds: accountId ? [accountId] : undefined,
        memberIds: memberId ? [memberId] : undefined,
        sources: source ? [source] : undefined,
        searchText: search,
        includeShadowed,
        before: beforeId,
        beforeOccurredAt: beforeAt,
        limit: PAGE_SIZE,
      },
      { grants },
    ),
    listAccounts({ householdId: ctx.household.id }, { grants }),
    listMembersAction({ householdId: ctx.household.id }),
  ]);

  const members = membersRes.ok ? membersRes.data : [];
  const memberNameById: Record<string, string> = {};
  for (const m of members) memberNameById[m.id] = m.displayName;

  // Compute next-page cursor when we got a full page back.
  let nextHref: string | undefined;
  if (transactions.length === PAGE_SIZE) {
    const last = transactions[transactions.length - 1];
    if (last) {
      const qp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string') qp.set(k, v);
      }
      qp.set('before', last.id);
      qp.set('beforeAt', last.occurredAt);
      nextHref = `/financial/transactions?${qp.toString()}`;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FinancialRealtimeRefresher householdId={ctx.household.id} />
      <TransactionsFilterBar
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        members={members.map((m) => ({ id: m.id, name: m.displayName }))}
        sources={KNOWN_SOURCES}
      />
      <TransactionsTable rows={transactions} memberNameById={memberNameById} nextHref={nextHref} />
    </div>
  );
}
