/**
 * `/settings/notifications` — auto-approval settings + recent suggestion
 * activity.
 *
 * Owner-only mutations: the multi-select for
 * `household.settings.approval.auto_approve_kinds` is disabled for
 * non-owners but still shows the current state.
 *
 * The recent-activity list reads `audit.event` rows whose `action`
 * starts with `suggestion.` or `action.` — approve / reject / execute
 * events for the household.
 */

import { listAutoApprovalAuditAction } from '@/app/actions/approval';
import { AutoApprovalForm } from '@/components/settings/AutoApprovalForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireHouseholdContext } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';

interface ApprovalSettingsBlob {
  approval?: {
    auto_approve_kinds?: string[];
  };
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function NotificationsSettingsPage() {
  const ctx = await requireHouseholdContext();
  const isOwner = ctx.member.role === 'owner';

  const settings = (ctx.household.settings ?? {}) as ApprovalSettingsBlob;
  const currentKinds = settings.approval?.auto_approve_kinds ?? [];

  const auditRes = isOwner
    ? await listAutoApprovalAuditAction({ limit: 10 })
    : { ok: true as const, data: { entries: [] } };
  const entries = auditRes.ok ? auditRes.data.entries : [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Auto-approval & notifications</h1>
        <p className="text-sm text-fg-muted">
          Choose which kinds of suggestions HomeHub can act on without a human tap. Destructive
          actions (subscription cancels, transfers, shared-expense settlements) always require
          approval.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Auto-approve these kinds</CardTitle>
          <CardDescription>
            When a suggestion with one of these kinds lands, HomeHub approves it automatically and
            dispatches the action. Owners can change this list; other members see the current state.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutoApprovalForm
            initialKinds={currentKinds}
            disabled={!isOwner}
            disabledReason="Only the household owner can change auto-approval preferences."
          />
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Suggestion activity</CardTitle>
            <CardDescription>
              Last 10 approve / reject / execute events for this household.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!auditRes.ok ? (
              <p className="text-sm text-danger">
                Failed to load activity: {auditRes.error.message}
              </p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-fg-muted">No recent activity.</p>
            ) : (
              <ul className="divide-y divide-border">
                {entries.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span className="font-mono text-xs">{e.action}</span>
                    <span className="flex-1 font-mono text-xs text-fg-muted">
                      {e.resourceType}
                      {e.resourceId ? ` · ${e.resourceId.slice(0, 8)}` : ''}
                    </span>
                    <span className="text-xs tabular-nums text-fg-muted">{formatWhen(e.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Browser and email notification preferences will land here in a later milestone. For now
            HomeHub only notifies via the in-app inbox.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-muted">No preferences configured yet.</p>
        </CardContent>
      </Card>
    </div>
  );
}
