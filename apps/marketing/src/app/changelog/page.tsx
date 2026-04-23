import { type Metadata } from 'next';

import { PageShell } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'What shipped, when, and why.',
};

type Entry = {
  version: string;
  date: string;
  title: string;
  bullets: string[];
};

const ENTRIES: Entry[] = [
  {
    version: 'v0.18.0',
    date: '2026-04-22',
    title: 'Grocery checkout flow',
    bullets: [
      'Turn a meal plan into a one-screen grocery run, grouped by store aisle.',
      'Instacart and Kroger exports behind a feature flag for hosted households.',
      'Fixes a long-standing bug where pantry items didn’t decrement after cooking.',
    ],
  },
  {
    version: 'v0.17.0',
    date: '2026-04-08',
    title: 'Alfred conversations, now titled',
    bullets: [
      'The chat assistant gives each thread a short, human title using Gemma.',
      'Threads are browsable by title instead of timestamp.',
    ],
  },
  {
    version: 'v0.16.2',
    date: '2026-03-27',
    title: 'Auth routing fix',
    bullets: [
      'Login and signup now always land on the app subdomain, not marketing.',
      'Clearer error messages when magic-link email delivery is delayed.',
    ],
  },
  {
    version: 'v0.16.0',
    date: '2026-03-14',
    title: 'Calendar overlays',
    bullets: [
      'Stack Google and iCloud calendars with household plans in one view.',
      'Per-member color picker so “who’s where” reads at a glance.',
      'Travel-time estimates for back-to-back events with different locations.',
    ],
  },
  {
    version: 'v0.15.0',
    date: '2026-02-26',
    title: 'Sunday recap v2',
    bullets: [
      'Shorter, quieter prose. Fewer bullets.',
      'Flags one thing per area that’s worth a family conversation.',
      'New “why am I seeing this?” on every recap item.',
    ],
  },
];

export default function ChangelogPage() {
  return (
    <PageShell
      eyebrow="// CHANGELOG"
      title="What shipped, when, and why."
      lede="We try to ship something small every week and something bigger every couple. Major releases are also posted to the GitHub releases page with a full diff."
    >
      <div style={{ marginTop: 32 }}>
        {ENTRIES.map((entry) => (
          <div
            key={entry.version}
            className="border-rule"
            style={{
              borderTop: '1px solid var(--color-rule)',
              padding: '28px 0',
            }}
          >
            <div
              className="text-sub font-mono"
              style={{ fontSize: 11, letterSpacing: 0.8, marginBottom: 10 }}
            >
              {entry.version} · {entry.date}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.4px',
                marginBottom: 12,
              }}
            >
              {entry.title}
            </div>
            <ul
              className="text-sub"
              style={{
                fontSize: 15.5,
                lineHeight: 1.65,
                margin: 0,
                paddingLeft: 20,
              }}
            >
              {entry.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
