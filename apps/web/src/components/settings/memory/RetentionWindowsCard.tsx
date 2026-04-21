/**
 * Retention windows card.
 *
 * Server shell that renders copy + a client `<RetentionSlider>` per
 * category. Owner-only edits; members see the values but the inputs
 * are disabled.
 */

import { RetentionSlider } from './RetentionSlider';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export type RetentionCategory = 'raw_emails' | 'raw_transactions' | 'attachments' | 'episodes';

const CATEGORY_COPY: Record<
  RetentionCategory,
  { label: string; helper: string; defaultDays: number }
> = {
  raw_emails: {
    label: 'Raw emails',
    helper: 'Raw email bodies beyond this window are deleted; extracted facts are kept forever.',
    defaultDays: 90,
  },
  raw_transactions: {
    label: 'Raw transactions',
    helper:
      'Raw transaction rows beyond this window are deleted; ledger summaries are kept forever.',
    defaultDays: 365,
  },
  attachments: {
    label: 'Attachments',
    helper: 'Attachments (receipts, PDFs) are deleted from storage after this window.',
    defaultDays: 30,
  },
  episodes: {
    label: 'Episodes',
    helper: 'Episodic memories older than this are archived; facts derived from them persist.',
    defaultDays: 730,
  },
};

const ORDER: RetentionCategory[] = ['raw_emails', 'raw_transactions', 'attachments', 'episodes'];

export interface RetentionWindowsCardProps {
  isOwner: boolean;
  retentionDays: Partial<Record<RetentionCategory | 'fact_candidates_expired', number>>;
  retentionUpdatedAt: Partial<Record<RetentionCategory, string>>;
}

function formatUpdatedAt(iso: string | undefined): string {
  if (!iso) return 'never updated';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'never updated';
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1_000));
  if (seconds < 60) return `updated ${seconds}s ago`;
  if (seconds < 3_600) return `updated ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `updated ${Math.floor(seconds / 3_600)}h ago`;
  return `updated ${Math.floor(seconds / 86_400)}d ago`;
}

export function RetentionWindowsCard({
  isOwner,
  retentionDays,
  retentionUpdatedAt,
}: RetentionWindowsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention windows</CardTitle>
        <CardDescription>
          How long HomeHub keeps the raw source rows behind memory. Facts extracted from these rows
          stay forever. The purge worker lands in M10 — edits here are stored today and take effect
          once the worker ships.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {ORDER.map((category) => {
          const copy = CATEGORY_COPY[category];
          const current = retentionDays[category] ?? copy.defaultDays;
          return (
            <div key={category} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-fg">{copy.label}</span>
                  <span className="text-xs text-fg-muted">{copy.helper}</span>
                </div>
                <span className="text-xs text-fg-muted">
                  {formatUpdatedAt(retentionUpdatedAt[category])} · purge worker lands in M10
                </span>
              </div>
              <RetentionSlider
                category={category}
                label={copy.label}
                initialDays={current}
                disabled={!isOwner}
              />
            </div>
          );
        })}

        <div className="flex flex-col gap-1 rounded-md border border-border bg-bg p-3 text-xs text-fg-muted">
          <span className="font-medium text-fg">Expired fact candidates</span>
          <span>
            Hardcoded at 90 days by the reconciler; not configurable from this page. The purge
            worker lands in M10.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
