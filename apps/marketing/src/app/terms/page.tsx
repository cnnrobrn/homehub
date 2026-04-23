import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The plain-English terms of using HomeHub.',
};

export default function TermsPage() {
  return (
    <PageShell
      eyebrow="// TERMS · LAST UPDATED 2026-04-23"
      title="The short version, written like a person."
      lede="These are the rules for using HomeHub. We've tried to keep them readable. If anything here feels off, write to us — we'd rather fix the terms than hide behind them."
    >
      <Section heading="Using HomeHub">
        You can use HomeHub to keep track of the shared life of a household. Be decent to the other
        people you invite. Don&apos;t use it to harass anyone or to store someone else&apos;s
        information without their knowledge. If you run it in a way that breaks the law where you
        live, that&apos;s on you, not us.
      </Section>
      <Section heading="Your account, your data">
        You (and your household) own the content you put in. We&apos;re a custodian, not an owner.
        You grant us only the permissions strictly required to run the service for you — host it,
        back it up, show it to the people you&apos;ve invited.
      </Section>
      <Section heading="Paid plans">
        Hosted plans are billed monthly. You can cancel any time from Settings and keep access until
        the end of the current period. If something goes sideways on our end and you&apos;ve paid
        for a month you couldn&apos;t use, write to us and we&apos;ll make it right.
      </Section>
      <Section heading="Open source">
        The HomeHub codebase is MIT licensed. You can run it yourself, fork it, or study it. The
        hosted service uses the same code plus some operational bits (billing, infra) that
        aren&apos;t part of the repo.
      </Section>
      <Section heading="What we don’t promise">
        HomeHub is a helpful notebook, not a guarantee. Double-check anything that matters — a bill,
        a prescription, a flight. We&apos;re not liable for decisions made based on what HomeHub
        suggests. The service is provided &quot;as is&quot;, without warranty, to the extent allowed
        by law.
      </Section>
      <Section heading="Ending the relationship">
        You can delete your household at any time. We can suspend accounts that abuse the service or
        put others at risk, but we&apos;ll tell you why and give you a chance to fix it before we do
        anything permanent.
      </Section>
      <Section heading="Changes to these terms">
        If we make a material change, we&apos;ll tell you in the app and by email at least 14 days
        before it takes effect. If you don&apos;t like the change, you can export your data and
        leave.
      </Section>
      <Section heading="Contact">
        Questions? Email{' '}
        <a href="mailto:hello@homehub.app" className="text-accent underline">
          hello@homehub.app
        </a>
        .
      </Section>
    </PageShell>
  );
}
