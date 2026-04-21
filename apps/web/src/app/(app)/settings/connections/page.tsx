/**
 * `/settings/connections` — list + manage provider connections.
 *
 * Server Component. Loads the household's connection rows via
 * `listConnectionsAction` and renders them as a simple table. The
 * "Connect Google Calendar" button is a plain anchor to the route
 * handler that kicks off the Nango hosted-auth flow; the "Disconnect"
 * button is a client-island form that calls
 * `disconnectConnectionAction`.
 *
 * Intentionally unpolished UI — M2-A lands the wiring; M2-C polishes.
 */

import { listConnectionsAction } from '@/app/actions/integrations';
import { DisconnectButton } from '@/components/settings/ConnectionsTable';
import { Button } from '@/components/ui/button';
import { getHouseholdContext } from '@/lib/auth/context';

const PROVIDER_LABELS: Record<string, string> = {
  'google-calendar': 'Google Calendar',
  gcal: 'Google Calendar',
};

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - d) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function statusBadge(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-accent/20 text-accent';
    case 'paused':
      return 'bg-surface text-fg-muted';
    case 'errored':
      return 'bg-destructive/20 text-destructive';
    case 'revoked':
      return 'bg-surface text-fg-muted/60';
    default:
      return 'bg-surface text-fg-muted';
  }
}

export default async function ConnectionsPage() {
  const ctx = await getHouseholdContext();
  if (!ctx) return null;

  const res = await listConnectionsAction();
  const connections = res.ok ? res.data : [];
  const isOwner = ctx.member.role === 'owner';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-fg-muted">
          Third-party accounts HomeHub is currently reading from. Connect your Google Calendar to
          sync events into the unified household calendar.
        </p>
      </header>

      {!res.ok ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          Failed to load connections: {res.error.message}
        </div>
      ) : null}

      <section aria-labelledby="connect-heading" className="flex flex-col gap-3">
        <h2 id="connect-heading" className="text-lg font-medium">
          Available providers
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href="/api/integrations/connect?provider=google-calendar">Connect Google Calendar</a>
          </Button>
          <span className="text-sm text-fg-muted" aria-live="polite">
            Other providers (Gmail, Monarch, YNAB) ship in later milestones.
          </span>
        </div>
      </section>

      <section aria-labelledby="connections-heading" className="flex flex-col gap-3">
        <h2 id="connections-heading" className="text-lg font-medium">
          Current connections
        </h2>
        {connections.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-muted">
            No providers connected yet.
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border text-left text-fg-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Last synced</th>
                <th className="py-2 pr-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((conn) => (
                <tr key={conn.id} className="border-b border-border/50">
                  <td className="py-2 pr-4">{providerLabel(conn.provider)}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${statusBadge(conn.status)}`}
                    >
                      {conn.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-fg-muted">{formatRelative(conn.lastSyncedAt)}</td>
                  <td className="py-2 pr-4">
                    {conn.status === 'revoked' ? (
                      <span className="text-fg-muted">—</span>
                    ) : isOwner ? (
                      <DisconnectButton connectionId={conn.id} />
                    ) : (
                      <span className="text-fg-muted">owner-only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
