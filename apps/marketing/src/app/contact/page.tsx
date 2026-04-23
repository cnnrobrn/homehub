import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach the HomeHub team — a real person answers every email.',
};

export default function ContactPage() {
  return (
    <PageShell
      eyebrow="// CONTACT"
      title="Write to us. A real person answers."
      lede="No ticket queue, no chatbot first-line. We're a small team, so you usually get a reply the same afternoon — sometimes from the person who wrote the feature you're asking about."
    >
      <Section heading="General help">
        Setup questions, &quot;how do I do X&quot;, or anything that&apos;s not working like you
        expected —{' '}
        <a href="mailto:help@homehub.app" className="text-accent underline">
          help@homehub.app
        </a>
        .
      </Section>
      <Section heading="Privacy">
        Data requests, account deletions, or anything that feels off about how we handle your
        household&apos;s data —{' '}
        <a href="mailto:privacy@homehub.app" className="text-accent underline">
          privacy@homehub.app
        </a>
        .
      </Section>
      <Section heading="Press">
        Writers, podcasters, researchers —{' '}
        <a href="mailto:press@homehub.app" className="text-accent underline">
          press@homehub.app
        </a>
        . See also the{' '}
        <a href="/press" className="text-accent underline">
          press page
        </a>
        .
      </Section>
      <Section heading="Open source">
        For code, bugs, and feature requests, the best place is a GitHub issue at{' '}
        <a
          href="https://github.com/homehub"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline"
        >
          github.com/homehub
        </a>
        .
      </Section>
      <Section heading="Jobs">
        We hire rarely but seriously —{' '}
        <a href="mailto:jobs@homehub.app" className="text-accent underline">
          jobs@homehub.app
        </a>
        .
      </Section>
      <Section heading="Everything else">
        If none of the above fits, try{' '}
        <a href="mailto:hello@homehub.app" className="text-accent underline">
          hello@homehub.app
        </a>{' '}
        — we read every one.
      </Section>
    </PageShell>
  );
}
