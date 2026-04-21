/**
 * Financial summary renderer.
 *
 * Spec anchors:
 *   - `specs/06-segments/financial/summaries-alerts.md` — section list
 *     for weekly + monthly templates.
 *   - `specs/05-agents/summaries.md` — output shape (markdown body,
 *     side-effect metrics).
 *
 * Output layout (markdown, ~20 lines):
 *   ### Weekly / Monthly Financial brief
 *   - Headline: total spend + "vs last period".
 *   - What changed: biggest category, biggest single transaction.
 *   - Account health: table of `{name, balance, staleDays}`.
 *   - Budgets: over-budget / at-budget / under-pace list.
 *
 * No model calls. Caller stamps the row with `model = 'deterministic'`.
 */

import {
  type AccountRow,
  type BudgetRow,
  type FinancialSummaryInput,
  type FinancialSummaryMetrics,
  type FinancialSummaryOutput,
  type SummaryPeriod,
  type TransactionRow,
} from './types.js';

export function renderFinancialSummary(input: FinancialSummaryInput): FinancialSummaryOutput {
  const metrics = computeMetrics(input);
  const bodyMd = renderMarkdown(input, metrics);
  return { bodyMd, metrics };
}

export function computeMetrics(input: FinancialSummaryInput): FinancialSummaryMetrics {
  const now = input.now ?? new Date();
  const inWindow = input.transactions.filter((t) => t.household_id === input.householdId);

  let totalSpend = 0;
  let totalIncome = 0;
  const byCategory = new Map<string, number>();
  let biggestTxn: TransactionRow | null = null;

  for (const tx of inWindow) {
    if (tx.amount_cents < 0) {
      const abs = Math.abs(tx.amount_cents);
      totalSpend += abs;
      const cat = tx.category ?? 'Uncategorized';
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + abs);
      if (!biggestTxn || abs > Math.abs(biggestTxn.amount_cents)) biggestTxn = tx;
    } else if (tx.amount_cents > 0) {
      totalIncome += tx.amount_cents;
    }
  }

  const biggestCategoryEntry = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
  const biggestCategory = biggestCategoryEntry
    ? { category: biggestCategoryEntry[0], spendCents: biggestCategoryEntry[1] }
    : null;

  const biggestTransaction = biggestTxn
    ? {
        id: biggestTxn.id,
        merchant: biggestTxn.merchant_raw ?? 'Unknown merchant',
        amountCents: biggestTxn.amount_cents,
      }
    : null;

  const vsPriorPeriodPct =
    input.priorPeriodSpendCents > 0
      ? (totalSpend - input.priorPeriodSpendCents) / input.priorPeriodSpendCents
      : 0;

  const accountHealth = input.accounts
    .filter((a) => a.household_id === input.householdId)
    .map((a) => ({
      accountName: a.name,
      balanceCents: a.balance_cents,
      staleDays: staleDays(a, now),
    }));

  const budgetProgress = input.budgets
    .filter((b) => b.household_id === input.householdId)
    .map((b) => {
      const spent = sumOutflowsForBudget(b, inWindow);
      const pct = b.amount_cents > 0 ? spent / b.amount_cents : 0;
      return {
        budgetId: b.id,
        category: b.category,
        amountCents: b.amount_cents,
        spentCents: spent,
        pct,
      };
    });

  return {
    totalSpendCents: totalSpend,
    totalIncomeCents: totalIncome,
    biggestCategory,
    biggestTransaction,
    accountHealth,
    vsPriorPeriodPct,
    budgetProgress,
  };
}

function sumOutflowsForBudget(budget: BudgetRow, transactions: TransactionRow[]): number {
  const cat = normalize(budget.category);
  let total = 0;
  for (const tx of transactions) {
    if (tx.amount_cents >= 0) continue;
    if (!tx.category) continue;
    if (normalize(tx.category) !== cat) continue;
    total += Math.abs(tx.amount_cents);
  }
  return total;
}

function staleDays(account: AccountRow, now: Date): number {
  if (!account.last_synced_at) return Number.POSITIVE_INFINITY;
  const last = new Date(account.last_synced_at).getTime();
  if (!Number.isFinite(last)) return Number.POSITIVE_INFINITY;
  const ms = now.getTime() - last;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function renderMarkdown(input: FinancialSummaryInput, metrics: FinancialSummaryMetrics): string {
  const header = periodHeader(input.period);
  const dateRange = `${formatDate(input.coveredStart)} – ${formatDate(input.coveredEnd)}`;

  const lines: string[] = [];
  lines.push(`### ${header}`);
  lines.push(`_${dateRange}_`);
  lines.push('');

  if (metrics.totalSpendCents === 0 && metrics.totalIncomeCents === 0) {
    lines.push('No financial activity in this period.');
    return lines.join('\n');
  }

  lines.push(`**Total spend:** ${formatCents(metrics.totalSpendCents)}`);
  if (metrics.totalIncomeCents > 0) {
    lines.push(`**Total income:** ${formatCents(metrics.totalIncomeCents)}`);
  }
  if (input.priorPeriodSpendCents > 0) {
    const delta = metrics.vsPriorPeriodPct;
    const direction = delta >= 0 ? 'up' : 'down';
    lines.push(`**vs last period:** ${direction} ${Math.round(Math.abs(delta) * 100)}%`);
  }
  lines.push('');

  if (metrics.biggestCategory) {
    lines.push(
      `**Biggest category:** ${metrics.biggestCategory.category} (${formatCents(metrics.biggestCategory.spendCents)})`,
    );
  }
  if (metrics.biggestTransaction) {
    lines.push(
      `**Biggest transaction:** ${metrics.biggestTransaction.merchant} — ${formatCents(Math.abs(metrics.biggestTransaction.amountCents))}`,
    );
  }
  lines.push('');

  if (metrics.accountHealth.length > 0) {
    lines.push('**Account health:**');
    for (const a of metrics.accountHealth) {
      const balance = a.balanceCents === null ? '—' : formatCents(a.balanceCents);
      const stale =
        a.staleDays === 0
          ? 'synced today'
          : a.staleDays === Number.POSITIVE_INFINITY
            ? 'never synced'
            : `${a.staleDays}d since sync`;
      lines.push(`- ${a.accountName}: ${balance} (${stale})`);
    }
    lines.push('');
  }

  if (metrics.budgetProgress.length > 0) {
    lines.push('**Budget progress:**');
    for (const b of metrics.budgetProgress) {
      const pct = Math.round(b.pct * 100);
      const status = b.pct >= 1 ? 'over' : b.pct >= 0.8 ? 'near' : 'on pace';
      lines.push(
        `- ${b.category}: ${formatCents(b.spentCents)} / ${formatCents(b.amountCents)} (${pct}% — ${status})`,
      );
    }
  }

  return lines.join('\n').trimEnd();
}

function periodHeader(period: SummaryPeriod): string {
  if (period === 'weekly') return 'Weekly financial brief';
  if (period === 'monthly') return 'Monthly financial brief';
  return 'Daily financial brief';
}

function formatCents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}
