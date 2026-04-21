/**
 * `/settings/memory` — the household's memory controls.
 *
 * Server Component that loads every read model the six cards need in a
 * single place, then hands off to small client islands for the actual
 * interactive bits (pause toggle, rule actions, danger-zone dialog).
 *
 * Cards, in order:
 *   1. Pause memory writes + warn banner.
 *   2. Retention windows.
 *   3. Rule authoring (+ table).
 *   4. Model budget + MTD spend.
 *   5. Weekly insights feed.
 *   6. Danger zone (owner-only).
 *
 * Only owners can mutate 1, 2, 4, 6. Any member can CRUD their own rules
 * (via RLS); the UI hides action buttons for rules they didn't author.
 */

import {
  getForgetAllRequestAction,
  getMonthToDateModelSpendAction,
  listHouseholdRulesAction,
  listInsightsAction,
} from '@/app/actions/memory';
import { DangerZone } from '@/components/settings/memory/DangerZone';
import { formatDistanceToNowIso } from '@/components/settings/memory/formatDistanceToNowIso';
import { InsightsFeed } from '@/components/settings/memory/InsightsFeed';
import { MemoryPauseToggle } from '@/components/settings/memory/MemoryPauseToggle';
import { ModelBudgetCard } from '@/components/settings/memory/ModelBudgetCard';
import {
  RetentionWindowsCard,
  type RetentionCategory,
} from '@/components/settings/memory/RetentionWindowsCard';
import { RuleCreateForm } from '@/components/settings/memory/RuleCreateForm';
import { RulesTable } from '@/components/settings/memory/RulesTable';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getHouseholdContext } from '@/lib/auth/context';

interface MemorySettingsBlob {
  writes_paused?: boolean;
  writes_paused_at?: string;
  writes_paused_by_member_id?: string;
  retention_days?: Partial<Record<RetentionCategory | 'fact_candidates_expired', number>>;
  retention_updated_at?: Partial<Record<RetentionCategory, string>>;
  model_budget_monthly_cents?: number;
}

export default async function MemorySettingsPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const isOwner = ctx.member.role === 'owner';
  const settings = (ctx.household.settings ?? {}) as { memory?: MemorySettingsBlob };
  const memory = settings.memory ?? {};

  const [rulesRes, insightsRes, spendRes, forgetRes] = await Promise.all([
    listHouseholdRulesAction(),
    listInsightsAction({ limit: 10 }),
    getMonthToDateModelSpendAction(),
    getForgetAllRequestAction(),
  ]);

  const rules = rulesRes.ok ? rulesRes.data : [];
  const insights = insightsRes.ok ? insightsRes.data : [];
  const mtdUsd = spendRes.ok ? spendRes.data.usd : 0;
  const monthStartIso = spendRes.ok
    ? spendRes.data.monthStartIso
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const pendingForget = forgetRes.ok ? forgetRes.data : null;

  const paused = memory.writes_paused === true;
  const pausedLabel = memory.writes_paused_at
    ? `Paused ${formatDistanceToNowIso(memory.writes_paused_at)}`
    : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="text-sm text-fg-muted">
          Controls for what HomeHub remembers, how long it keeps raw source rows, and the rules and
          insights derived from them.
        </p>
      </header>

      {paused ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm"
        >
          <span className="font-medium text-danger">Memory writes are paused.</span>{' '}
          <span className="text-fg-muted">
            Extraction, consolidation, and reflection continue reading raw data but will not write
            new episodes, facts, or insights until an owner resumes.
          </span>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ */}
      {/* 1. Pause writes */}
      {/* ------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Memory status</CardTitle>
          <CardDescription>
            Pausing stops all new writes to episodes, facts, patterns, and insights. Useful during a
            household transition (someone moved out, travel season) when you want the assistant to
            stop learning incorrect patterns.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isOwner ? (
            <MemoryPauseToggle initialPaused={paused} />
          ) : (
            <div className="rounded-md border border-border bg-bg p-3 text-sm text-fg-muted">
              Memory is currently <strong>{paused ? 'paused' : 'active'}</strong>. Only the
              household owner can change this.
            </div>
          )}
          {pausedLabel ? <p className="text-xs text-fg-muted">{pausedLabel}</p> : null}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ */}
      {/* 2. Retention windows */}
      {/* ------------------------------------------------------------ */}
      <RetentionWindowsCard
        isOwner={isOwner}
        retentionDays={memory.retention_days ?? {}}
        retentionUpdatedAt={memory.retention_updated_at ?? {}}
      />

      {/* ------------------------------------------------------------ */}
      {/* 3. Rules */}
      {/* ------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Household rules</CardTitle>
          <CardDescription>
            Preferences authored by members. The assistant honors these when retrieving memory and
            when suggesting actions. You can only edit or delete rules you authored.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!rulesRes.ok ? (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
              Failed to load rules: {rulesRes.error.message}
            </div>
          ) : (
            <RulesTable rules={rules} />
          )}
          <div className="rounded-md border border-border bg-bg p-4">
            <h3 className="mb-3 text-sm font-semibold">Add a rule</h3>
            <RuleCreateForm />
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ */}
      {/* 4. Model budget */}
      {/* ------------------------------------------------------------ */}
      <ModelBudgetCard
        isOwner={isOwner}
        currentCents={memory.model_budget_monthly_cents ?? 0}
        mtdUsd={mtdUsd}
        monthStartIso={monthStartIso}
      />

      {/* ------------------------------------------------------------ */}
      {/* 5. Weekly insights */}
      {/* ------------------------------------------------------------ */}
      <InsightsFeed insights={insights} currentMemberId={ctx.member.id} />

      {/* ------------------------------------------------------------ */}
      {/* 6. Danger zone */}
      {/* ------------------------------------------------------------ */}
      {isOwner ? <DangerZone pendingRequest={pendingForget} /> : null}
    </div>
  );
}
