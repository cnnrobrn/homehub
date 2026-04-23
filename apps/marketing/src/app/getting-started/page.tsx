import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';
import { APP_LOGIN_URL } from '@/lib/app-url';

export const metadata: Metadata = {
  title: 'Getting started',
  description: 'A 10-minute setup guide for a brand-new HomeHub household.',
};

export default function GettingStartedPage() {
  return (
    <PageShell
      eyebrow="// HELP · GETTING STARTED"
      title="Ten minutes on a Sunday, and you're set up."
      lede="You don't need to fill out every field. You don't need to move everything over on day one. Just start with the three or four things that actually clutter your week, and let HomeHub take them off your plate."
    >
      <Section heading="1. Create your household">
        Sign in with your email. The first person becomes the household admin — you can hand that
        off to a partner later.{' '}
        <a href={APP_LOGIN_URL} className="text-accent underline">
          Start a household →
        </a>
      </Section>
      <Section heading="2. Connect what clutters your week">
        In <em>Settings → Connections</em>, link whichever of these apply: a calendar (Google or
        iCloud), your bank (read-only, via Plaid), and a grocery app. You can skip any of them and
        come back later — HomeHub works fine without every box ticked.
      </Section>
      <Section heading="3. Invite the household">
        Add your partner, your kids (12+), a grandparent, a babysitter. Each person gets their own
        view. There&apos;s a whole page on this at{' '}
        <a href="/invite" className="text-accent underline">
          Invite your family
        </a>
        .
      </Section>
      <Section heading="4. Let the first week happen">
        HomeHub gets quieter the more it learns. For the first few days, it will ask a couple of
        small clarifying questions — who usually cooks on Tuesdays, whose calendar the kids&apos;
        stuff lives on — and then it settles down.
      </Section>
      <Section heading="5. Expect your first Sunday recap">
        Next Sunday evening, you&apos;ll get a short recap of the coming week: money, meals, plans,
        people. That&apos;s the moment most families say &quot;oh, okay, this is actually
        useful.&quot;
      </Section>
      <Section heading="Stuck on something?">
        Email{' '}
        <a href="mailto:help@homehub.app" className="text-accent underline">
          help@homehub.app
        </a>{' '}
        — we answer within a day, usually same afternoon.
      </Section>
    </PageShell>
  );
}
