/**
 * `/financial/accounts` — account health grid.
 *
 * Server Component. One card per `app.account` row.
 */

import { AccountCard } from '@/components/financial/AccountCard';
import { FinancialRealtimeRefresher } from '@/components/financial/FinancialRealtimeRefresher';
import { getHouseholdContext } from '@/lib/auth/context';
import { listAccounts, type SegmentGrant } from '@/lib/financial';

export default async function AccountsPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;
  const grants: SegmentGrant[] = ctx.grants.map((g) => ({
    segment: g.segment as string,
    access: g.access,
  }));
  const accounts = await listAccounts({ householdId: ctx.household.id }, { grants });

  return (
    <div className="flex flex-col gap-4">
      <FinancialRealtimeRefresher householdId={ctx.household.id} />
      {accounts.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-fg-muted">
          No accounts yet. Connect YNAB, Monarch, or Plaid in settings.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} />
          ))}
        </div>
      )}
    </div>
  );
}
