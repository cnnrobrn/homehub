import { Footer } from './Footer';
import { Nav } from './Nav';

import type { ReactNode } from 'react';

type Props = {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
};

export function PageShell({ eyebrow, title, lede, children }: Props) {
  return (
    <>
      <Nav />
      <main>
        <section
          className="hh-section"
          style={{
            padding: '88px 56px 32px',
            maxWidth: 880,
          }}
        >
          <div
            className="text-accent font-mono"
            style={{ fontSize: 11, letterSpacing: 1, marginBottom: 20 }}
          >
            {eyebrow}
          </div>
          <h1
            style={{
              fontSize: 56,
              fontWeight: 600,
              lineHeight: 1.04,
              letterSpacing: '-1.8px',
              margin: 0,
              textWrap: 'balance',
            }}
          >
            {title}
          </h1>
          {lede ? (
            <p
              className="text-sub"
              style={{
                fontSize: 19,
                lineHeight: 1.55,
                marginTop: 24,
                maxWidth: 640,
              }}
            >
              {lede}
            </p>
          ) : null}
        </section>
        <section
          className="hh-section"
          style={{
            padding: '24px 56px 96px',
            maxWidth: 760,
          }}
        >
          <div
            style={{
              fontSize: 16.5,
              lineHeight: 1.7,
              color: 'var(--color-ink)',
            }}
          >
            {children}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

type SectionProps = {
  heading: string;
  children: ReactNode;
};

export function Section({ heading, children }: SectionProps) {
  return (
    <div style={{ marginTop: 40 }}>
      <h2
        style={{
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '-0.4px',
          margin: '0 0 14px',
        }}
      >
        {heading}
      </h2>
      <div className="text-sub" style={{ fontSize: 16.5, lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  );
}
