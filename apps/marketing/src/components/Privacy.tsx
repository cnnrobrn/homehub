import { CheckIcon } from './Logo';

const BULLETS = [
  'Your family’s data is never sold. Ever.',
  'No ads. No analytics. No weird stuff.',
  'Export everything, anytime, as normal files.',
  'If you want to self-host, you can — one command.',
];

export function Privacy() {
  return (
    <section
      id="open-source"
      className="hh-section hh-privacy border-rule border-t border-b"
      style={{
        padding: '100px 56px',
        background: 'var(--color-warm-sand)',
      }}
    >
      <div
        className="hh-privacy-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 64,
          alignItems: 'center',
        }}
      >
        <div>
          <div
            className="text-sub font-mono"
            style={{ fontSize: 11, letterSpacing: 1, marginBottom: 8 }}
          >
            {'// YOUR HOME · YOUR DATA'}
          </div>
          <div
            style={{
              fontSize: 42,
              fontWeight: 600,
              letterSpacing: '-1.4px',
              marginBottom: 20,
              textWrap: 'balance',
            }}
          >
            Private by default. Yours forever.
          </div>
          <p className="text-sub" style={{ fontSize: 17, lineHeight: 1.6, marginBottom: 28 }}>
            HomeHub is an open-source project — that means you can read exactly what it does, run it
            on your own computer if you want, and walk away with all your data any time.
          </p>
          {BULLETS.map((label) => (
            <div
              key={label}
              className="flex items-start"
              style={{ gap: 10, marginBottom: 10, fontSize: 15, lineHeight: 1.5 }}
            >
              <div style={{ marginTop: 3 }}>
                <CheckIcon />
              </div>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div
          className="bg-card"
          style={{
            border: '1px solid var(--color-rule)',
            borderRadius: 8,
            padding: 28,
          }}
        >
          <div
            className="text-sub font-mono"
            style={{ fontSize: 11, letterSpacing: 0.5, marginBottom: 14 }}
          >
            A NOTE FROM THE TEAM
          </div>
          <div style={{ fontSize: 15.5, lineHeight: 1.65, marginBottom: 14 }}>
            We made HomeHub because we were tired of apps that treat family life like a product to
            optimize. Your home isn&apos;t a funnel. Your week isn&apos;t a metric.
          </div>
          <div style={{ fontSize: 15.5, lineHeight: 1.65, marginBottom: 18 }}>
            We charge a small monthly fee if you want us to host it. The code is free, forever.
            That&apos;s the whole business.
          </div>
          <div
            className="flex items-center border-rule"
            style={{
              gap: 10,
              paddingTop: 16,
              borderTop: '1px solid var(--color-rule)',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                background: 'var(--color-area-people)',
                opacity: 0.7,
              }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>The HomeHub team</div>
              <div className="text-sub font-mono" style={{ fontSize: 11.5 }}>
                a small group of parents &amp; partners
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
