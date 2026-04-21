/**
 * Server shell for the weekly insights feed.
 *
 * Renders up to 10 `mem.insight` rows, newest first, as `<InsightCard>`
 * children. Empty state is informative rather than alarming — insights
 * only ship on the weekly reflection cron cadence.
 */

import { InsightCard } from './InsightCard';

import type { InsightSummary } from '@/app/actions/memory';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface InsightsFeedProps {
  insights: InsightSummary[];
  currentMemberId: string;
}

export function InsightsFeed({ insights, currentMemberId }: InsightsFeedProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly insights</CardTitle>
        <CardDescription>
          Patterns HomeHub noticed in the past week. Confirming an insight nudges retrieval toward
          similar patterns; dismissing one signals we got it wrong.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {insights.length === 0 ? (
          <div className="rounded-md border border-border bg-bg p-4 text-sm text-fg-muted">
            No weekly insights yet. The reflection worker writes one per household per week; the
            next run will backfill this list.
          </div>
        ) : (
          insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} currentMemberId={currentMemberId} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
