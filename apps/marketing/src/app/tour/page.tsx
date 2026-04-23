import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';
import { APP_LOGIN_URL } from '@/lib/app-url';

export const metadata: Metadata = {
  title: 'Try a tour',
  description:
    'A two-minute walk-through of HomeHub — what it tracks, who sees what, and what a Sunday looks like.',
};

export default function TourPage() {
  return (
    <PageShell
      eyebrow="// TOUR · 2 MINUTES"
      title="A quick walk through a HomeHub Sunday."
      lede="No signup. Just a quiet look at what's in the app, how the four areas fit together, and what the weekly recap actually feels like."
    >
      <Section heading="1. Sunday evening, the recap lands">
        HomeHub gives each household a short, prose recap of the coming week. Not a dashboard —
        three or four paragraphs that read like a thoughtful partner caught you up on what&apos;s
        ahead. You open it with a cup of tea.
      </Section>
      <Section heading="2. Four areas, all muted">
        Money, Meals, Plans, People. Each one is a quiet tab with just the week&apos;s relevant
        items. If an area doesn&apos;t apply to your household, turn it off — it disappears.
      </Section>
      <Section heading="3. The week view">
        A calendar, but opinionated. It knows whose turn it is to cook, who&apos;s picking up the
        kids, when rent hits, and when you said yes to dinner at Tala&apos;s. Color-coded by area,
        not by person.
      </Section>
      <Section heading="4. The ask bar">
        Tap <kbd>⌘K</kbd> (or the plus on mobile) and type anything in plain English. &quot;When is
        Mom&apos;s birthday?&quot; &quot;How much did we spend on groceries last month?&quot;
        &quot;Add a pediatrician appointment for Leo next Wednesday at 4.&quot;
      </Section>
      <Section heading="5. Visibility, dialed in">
        Every item has a little visibility dot. Partner sees this, kids don&apos;t. Babysitter sees
        just Thursday. Grandma sees the birthdays but not the bills.
      </Section>
      <Section heading="Ready to try the real thing?">
        It takes about ten minutes to set up, free for 30 days.
        <div style={{ marginTop: 20 }}>
          <a
            href={APP_LOGIN_URL}
            className="bg-ink text-bg"
            style={{
              display: 'inline-block',
              padding: '13px 22px',
              borderRadius: 3,
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            Try it free →
          </a>
        </div>
      </Section>
    </PageShell>
  );
}
