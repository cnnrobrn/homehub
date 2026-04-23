import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Contribute',
  description: 'How to help build HomeHub — as a coder, a writer, or just a thoughtful user.',
};

export default function ContributePage() {
  return (
    <PageShell
      eyebrow="// OPEN SOURCE · CONTRIBUTE"
      title="Help build the next version."
      lede="HomeHub is small on purpose. We don't need a thousand contributors — we need a few dozen thoughtful ones. If that sounds like you, here's where to start."
    >
      <Section heading="Code">
        Browse the{' '}
        <a
          href="https://github.com/homehub"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline"
        >
          GitHub repo
        </a>
        . Issues tagged <code>good first issue</code> are genuinely good first issues — small,
        well-scoped, and reviewable within a day or two. Please open a discussion before starting
        anything larger.
      </Section>
      <Section heading="Design">
        We love thoughtful design feedback, especially from people who use HomeHub in a real
        household. Open a GitHub issue with a screenshot and what feels off. Full redesigns are
        harder to land; start with a specific frustration.
      </Section>
      <Section heading="Writing">
        The{' '}
        <a href="/getting-started" className="text-accent underline">
          getting-started guide
        </a>
        , the{' '}
        <a href="/tips" className="text-accent underline">
          tips page
        </a>
        , and the in-app copy can always be tighter and warmer. PRs against{' '}
        <code>apps/marketing/</code> are very welcome.
      </Section>
      <Section heading="Integrations">
        New calendar, grocery, or bank integrations are the highest-leverage contributions. There is
        a template in <code>packages/integrations/_template/</code> with a test harness and
        checklist. Email{' '}
        <a href="mailto:help@homehub.app" className="text-accent underline">
          help@homehub.app
        </a>{' '}
        if you want a design chat first.
      </Section>
      <Section heading="Reporting bugs">
        If it&apos;s clearly a bug, open an issue with steps to reproduce and whether you&apos;re on
        hosted or self-hosted. If you&apos;re not sure, email{' '}
        <a href="mailto:help@homehub.app" className="text-accent underline">
          help@homehub.app
        </a>{' '}
        and we&apos;ll turn it into an issue for you.
      </Section>
      <Section heading="Code of conduct">
        Be kind. Assume good faith. Criticize ideas, not people. That&apos;s the whole policy — full
        text lives in <code>CODE_OF_CONDUCT.md</code> in the repo.
      </Section>
    </PageShell>
  );
}
