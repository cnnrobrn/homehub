import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Press',
  description: 'A kit for writers, podcasters, and anyone covering HomeHub.',
};

export default function PressPage() {
  return (
    <PageShell
      eyebrow="// PRESS"
      title="Covering HomeHub? Here’s everything in one place."
      lede="We're a small team and we love talking to people who write about family life, household tech, and the open-source side of the internet. Use whatever you need below."
    >
      <Section heading="The short description">
        HomeHub is an open-source, self-hostable notebook for a household — a quiet shared brain for
        dinners, bills, birthdays, and weekend plans. Free to self-host forever; $8/month if
        you&apos;d rather we run it.
      </Section>
      <Section heading="The one-line positioning">
        The quiet place your household runs from.
      </Section>
      <Section heading="Press kit">
        Logos, screenshots, and founder bios are bundled in the press kit. Email{' '}
        <a href="mailto:press@homehub.app" className="text-accent underline">
          press@homehub.app
        </a>{' '}
        and we&apos;ll send you the latest zip plus answer any questions the same day.
      </Section>
      <Section heading="Interviews & quotes">
        Happy to do a quick email Q&amp;A, a phone call, or a podcast. Turnaround is usually 24–48
        hours. Please include your outlet, a rough publish date, and what angle you&apos;re working.
      </Section>
      <Section heading="What we’re comfortable saying on the record">
        Why we&apos;re open source, how we think about privacy, how families actually use HomeHub,
        why we chose a flat per-household price, and what we refuse to build (streaks, nudges,
        anything that treats a home like a funnel).
      </Section>
    </PageShell>
  );
}
