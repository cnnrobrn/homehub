/**
 * `<ReciprocityCard />` — compact "we hosted vs. they hosted" summary
 * rendered on the person-detail page.
 */

export interface ReciprocityCardProps {
  weHosted: number;
  hostedUs: number;
  totalEpisodes: number;
}

function formatRatio(w: number, h: number): string {
  if (w === 0 && h === 0) return 'No hosting episodes recorded.';
  if (h === 0) return `We hosted ${w}× — they have not hosted us in this window.`;
  if (w === 0) return `They hosted us ${h}× — we have not hosted them yet.`;
  const ratio = (w / h).toFixed(1);
  return `We hosted ${w}×, they hosted us ${h}× (${ratio}× ratio).`;
}

export function ReciprocityCard({ weHosted, hostedUs, totalEpisodes }: ReciprocityCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <h3 className="text-xs uppercase tracking-wide text-fg-muted">Reciprocity</h3>
      <p className="mt-1 text-fg">{formatRatio(weHosted, hostedUs)}</p>
      {totalEpisodes > 0 ? (
        <p className="mt-1 text-xs text-fg-muted">
          Based on {totalEpisodes} episode{totalEpisodes === 1 ? '' : 's'} with a place recorded.
        </p>
      ) : null}
    </div>
  );
}
