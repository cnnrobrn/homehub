import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'About',
  description: 'Why HomeHub exists, and who it&apos;s for.',
};

export default function AboutPage() {
  return (
    <PageShell
      eyebrow="// ABOUT"
      title="A small tool for the people under one roof."
      lede="HomeHub is made by a small group of parents and partners who got tired of running their lives out of 14 apps, a shared Google Doc, and a family group chat nobody reads."
    >
      <Section heading="Why it exists">
        The small stuff of a household — rent is due, Leo needs a packed lunch, Mom&apos;s birthday
        is on Tuesday — shouldn&apos;t live only in one person&apos;s head. We wanted a quiet place
        where the whole house could see what&apos;s coming and nobody had to be the designated
        rememberer.
      </Section>
      <Section heading="What makes it different">
        No streaks. No nudges. No notifications designed to keep you in the app. HomeHub is built to
        be useful enough that you close it and go do something else. The win state is a calm Sunday
        evening, not daily active users.
      </Section>
      <Section heading="How we make money">
        We charge a small monthly fee to host HomeHub for you. That&apos;s it. The code is open
        source and free to self-host. We don&apos;t take investor money that pressures us to
        monetize your attention, and we don&apos;t sell data. We&apos;d rather stay small and useful
        than get big and weird.
      </Section>
      <Section heading="Who makes it">
        HomeHub is built by a small remote team. We&apos;re parents, partners, siblings, and
        roommates — so we&apos;re building for ourselves too. If you&apos;d like to work with us,
        say hello:{' '}
        <a href="mailto:jobs@homehub.app" className="text-accent underline">
          jobs@homehub.app
        </a>
        .
      </Section>
    </PageShell>
  );
}
