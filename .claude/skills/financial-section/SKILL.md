---
name: financial-section
description: Populate data and add tabs/functionality in the Financial section (/financial). Use when the user wants to seed transactions/accounts/budgets/subscriptions/alerts, add a new financial tab (e.g. investments, goals, reports), wire a server action for financial CRUD, or expose a financial tool to the Hermes chat agent.
---

# Financial section

Household ledger. Gated on the `financial:read` segment grant.

## Surface area

- Route root: `apps/web/src/app/(app)/financial/page.tsx` (+ `layout.tsx`
  with access gate).
- Current tabs (see `apps/web/src/components/financial/FinancialSubNav.tsx`):
  Overview, Transactions, Accounts, Budgets, Subscriptions, Calendar,
  Summaries, Alerts.
- Data tables (migration
  `packages/db/supabase/migrations/0005_event_transaction_account.sql`):
  `app.account`, `app.transaction`, `app.budget`, `app.event` (financial
  events). Alerts/suggestions land in `app.alert` / `app.suggestion` (0007).
- Components: `apps/web/src/components/financial/*`.
- Agent tools: `packages/tools/src/tools/` — `listTransactions.ts`,
  `getAccountBalances.ts`, `getBudgetStatus.ts`, `proposeCancelSubscription.ts`,
  `proposeTransfer.ts`, `settleSharedExpense.ts`.
- Access helpers: `apps/web/src/lib/financial.ts` (`hasFinancialRead`,
  `SegmentGrant`).

## Populate data

1. **Local dev seed (SQL)** — append idempotent inserts to
   `packages/db/supabase/seed.sql`. Seed order: `app.account` →
   `app.transaction` (FK to account) → `app.budget`. Use realistic
   `posted_at` timestamps spread across the last 60 days.
2. **Chat-driven** — most financial writes are intentionally **draft-write**
   (`proposeTransfer`, `proposeCancelSubscription`) and require user
   approval in `/suggestions`. Keep new write tools on this path unless the
   user explicitly asks for direct-write.
3. **UI write path** — server actions colocated under
   `apps/web/src/app/actions/financial/`. Revalidate the specific subroute
   after a write (`revalidatePath('/financial/transactions')`).

## Add a tab

1. Create `apps/web/src/app/(app)/financial/<tab>/page.tsx` (Server
   Component). Re-check the grant using `hasFinancialRead` if the page
   exposes sensitive data beyond what the layout already gates.
2. Extend `FinancialSubNav.tsx`: add to the `Tab.href` literal union, and
   append the tab to the `TABS` array.
3. Reuse `FinancialRealtimeRefresher.tsx` if the tab needs Supabase realtime
   refresh on writes.
4. Add a test mirroring `FinancialSummaryCard.test.tsx` conventions.

## Gotchas

- `app.transaction.amount_cents` is `bigint`, not a numeric dollar — always
  divide by 100 in UI and never mix units.
- `app.account.kind` is a check-constrained enum; new account types need a
  migration.
- Subscriptions are currently derived rows; avoid creating a parallel
  `subscription` table without checking the reconciler worker first
  (`apps/workers/reconciler`).
