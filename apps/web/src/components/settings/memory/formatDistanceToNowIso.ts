/**
 * Tiny "N minutes ago" formatter used across the memory settings page.
 *
 * No-dep, UTC-friendly, and renders the same on the server + client so
 * we don't hydrate-mismatch. Not timezone-aware — we're displaying
 * relative durations, not absolute clock times.
 */

export function formatDistanceToNowIso(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
