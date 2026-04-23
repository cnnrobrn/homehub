import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Invite your family',
  description:
    'How to add partners, kids, grandparents, and babysitters to your HomeHub household.',
};

export default function InvitePage() {
  return (
    <PageShell
      eyebrow="// HELP · INVITES"
      title="Bring the whole house in — at the level that makes sense."
      lede="Not everyone in a household needs to see everything. HomeHub lets you share the right slice with the right person, from a partner who sees it all to a babysitter who only sees Thursday evening."
    >
      <Section heading="Send an invite">
        In <em>Settings → Members</em>, hit <em>Invite</em>, pick a role, and enter an email. The
        invitee gets a one-click link. They don&apos;t need a password — we use magic links — so
        even grandparents handle it fine.
      </Section>
      <Section heading="Roles, in plain English">
        <div style={{ marginTop: 6 }}>
          <strong>Partner.</strong> Sees and edits everything, like you.
        </div>
        <div style={{ marginTop: 10 }}>
          <strong>Kid (12+).</strong> Sees their own calendar, chores, allowance. Doesn&apos;t see
          finances.
        </div>
        <div style={{ marginTop: 10 }}>
          <strong>Kid (under 12).</strong> Represented in the household but doesn&apos;t have a
          login.
        </div>
        <div style={{ marginTop: 10 }}>
          <strong>Extended family.</strong> Grandparents, aunts, uncles. Sees the calendar and
          birthdays; not the money stuff.
        </div>
        <div style={{ marginTop: 10 }}>
          <strong>Helper.</strong> Babysitters, dog-walkers, cleaners. Sees only the specific days
          and instructions you&apos;ve shared with them.
        </div>
      </Section>
      <Section heading="Change who sees what">
        Every tile in HomeHub has a little visibility dot. Tap it to pick who in your household can
        see that thing — &quot;everyone&quot;, &quot;adults&quot;, &quot;just you and your
        partner&quot;, or a specific person. You can change your mind at any time.
      </Section>
      <Section heading="Removing someone">
        Life changes. In <em>Settings → Members</em>, you can revoke access in one click. Their view
        goes dark immediately; nothing they added is deleted unless you ask for it to be.
      </Section>
    </PageShell>
  );
}
