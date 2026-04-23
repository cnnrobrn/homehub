import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Tips',
  description: 'Small habits that make HomeHub feel noticeably lighter.',
};

export default function TipsPage() {
  return (
    <PageShell
      eyebrow="// HELP · TIPS"
      title="A handful of small habits that make HomeHub feel lighter."
      lede="None of this is required. But these are the patterns we see the households who love HomeHub settle into after a month or two."
    >
      <Section heading="Read the Sunday recap together">
        Fifteen minutes on a Sunday evening, partner next to you, scrolling through next week&apos;s
        recap. It&apos;s the single highest-value habit — and it usually surfaces one thing you
        would have forgotten.
      </Section>
      <Section heading="Let HomeHub write the grocery list">
        If you&apos;ve turned on meals, HomeHub already knows what you&apos;re cooking. Ask the
        assistant to &quot;build the list for this week&quot; and review it rather than writing one
        from scratch.
      </Section>
      <Section heading="Use the quick-add">
        Tap <kbd>⌘K</kbd> (or the little plus on mobile) and type in plain English: &quot;pick up
        Leo at 3 on Thursday&quot;, &quot;rent is $2,400&quot;, &quot;Mom&apos;s birthday is next
        Tuesday&quot;. HomeHub figures out which area it belongs in.
      </Section>
      <Section heading="Put one thing on the fridge">
        The print-friendly weekly view in <em>Week → Print</em> is designed for a single sheet of
        paper stuck to the fridge. Some households do this, some don&apos;t. It&apos;s there if it
        helps.
      </Section>
      <Section heading="Turn off what you don't need">
        If finances stress you out, turn the whole Money area off. Same for Meals, Plans, People.
        HomeHub is useful with one area on.
      </Section>
      <Section heading="Let the kids add stuff">
        Once kids hit 12 or so, letting them add their own stuff (practice, sleepovers, school
        trips) means you don&apos;t have to — and they feel a bit more in charge of their own week.
      </Section>
    </PageShell>
  );
}
