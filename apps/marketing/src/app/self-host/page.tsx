import { type Metadata } from 'next';

import { PageShell, Section } from '@/components/PageShell';

export const metadata: Metadata = {
  title: 'Self-host guide',
  description: 'Run HomeHub on your own machine. One command, MIT licensed, free forever.',
};

export default function SelfHostPage() {
  return (
    <PageShell
      eyebrow="// OPEN SOURCE · SELF-HOST"
      title="Run HomeHub on your own machine."
      lede="The whole HomeHub codebase is MIT licensed. If you'd rather not let our servers touch your household's data, you don't have to. One command gets you a working instance on a Mac mini, a Linux box, or a spare laptop."
    >
      <Section heading="What you'll need">
        A machine running Linux or macOS, Docker, and about 2GB of RAM. That&apos;s it. No
        Kubernetes, no Postgres cluster — a single container with an embedded database.
      </Section>
      <Section heading="The one command">
        <div
          className="font-mono"
          style={{
            marginTop: 8,
            padding: '14px 16px',
            background: 'var(--color-terminal-bg)',
            color: 'var(--color-terminal-fg)',
            borderRadius: 6,
            fontSize: 13.5,
            lineHeight: 1.6,
            overflow: 'auto',
          }}
        >
          curl -sSL https://get.homehub.app | sh
        </div>
        <div style={{ marginTop: 10 }}>
          It pulls the latest image, writes a <code>homehub.env</code> next to it, and prints the
          URL to open in your browser.
        </div>
      </Section>
      <Section heading="Connecting your integrations">
        Calendar, bank, and grocery integrations need API keys from their respective providers.
        Self-hosted instances use your own keys — we walk through each one in the repo&apos;s{' '}
        <code>docs/integrations/</code> folder.
      </Section>
      <Section heading="Updating">
        <code>homehub upgrade</code> pulls the latest image, runs any migrations, and restarts the
        container. We cut a release about every two weeks. Breaking changes come with a heads-up in
        the{' '}
        <a href="/changelog" className="text-accent underline">
          changelog
        </a>
        .
      </Section>
      <Section heading="Backups">
        The container writes to <code>~/.homehub/data/</code>. Back that directory up however you
        already back things up (Time Machine, restic, rsync to a NAS). That&apos;s the whole backup
        story.
      </Section>
      <Section heading="Getting help">
        Open a discussion on{' '}
        <a
          href="https://github.com/homehub"
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline"
        >
          github.com/homehub
        </a>
        , or email{' '}
        <a href="mailto:help@homehub.app" className="text-accent underline">
          help@homehub.app
        </a>
        . We help self-hosters too — not just paying customers.
      </Section>
    </PageShell>
  );
}
