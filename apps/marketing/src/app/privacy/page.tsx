import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'HomeHub is built around a simple idea: your household data belongs to you. No ads, no analytics, no selling.',
};

export default function PrivacyPage() {
  return (
    <PageShell
      eyebrow="// PRIVACY · LAST UPDATED 2026-04-23"
      title="Private by default. Yours forever."
      lede="HomeHub is a quiet notebook for your household. The only reason it exists is to help the people under one roof get on the same page. That shapes every decision we make about data."
    >
      <Section heading="What we believe">
        We don&apos;t think family life should be a product to optimize. Your calendar, your
        groceries, your kids&apos; doctor appointments — none of that is ours to mine. The whole
        business model is: you pay us a small monthly fee to run the software for you, or you run it
        yourself for free. That&apos;s the deal.
      </Section>
      <Section heading="What we collect">
        Only what the app needs to work for your household: the data you (and people you invite) put
        into HomeHub, the accounts you explicitly connect (calendars, bank read-only, groceries),
        and basic operational logs. No third-party trackers. No ad SDKs. No behavioural analytics.
      </Section>
      <Section heading="What we never do">
        We do not sell your data. We do not share it with advertisers or data brokers. We do not
        train third-party AI models on the contents of your household. We do not read your notes to
        improve our marketing.
      </Section>
      <Section heading="Who sees what inside your household">
        Each household has its own space. Members you invite can see what you choose to share with
        them — a partner sees more than a babysitter. Admins can adjust these visibility rules at
        any time from Settings.
      </Section>
      <Section heading="AI features">
        When you use features like the weekly recap or the chat assistant, your household&apos;s
        context is sent to a language model to produce a response. We use providers who contract not
        to train on our traffic. You can turn these features off per-household in Settings.
      </Section>
      <Section heading="Exporting and deleting">
        You can export everything, any time, as normal files (JSON and CSV). You can also delete
        your household from Settings. Deletion removes your data from our primary systems within 7
        days and from encrypted backups within 30.
      </Section>
      <Section heading="Self-hosting">
        If you&apos;d rather none of this touch our servers, you don&apos;t have to. HomeHub is open
        source and one command away from running on your own machine. See the{' '}
        <a href="/self-host" className="text-accent underline">
          self-host guide
        </a>
        .
      </Section>
      <Section heading="Contact">
        Questions, requests, or a privacy concern? Email{' '}
        <a href="mailto:privacy@homehub.app" className="text-accent underline">
          privacy@homehub.app
        </a>
        . A real person will write back.
      </Section>
    </PageShell>
  );
}
