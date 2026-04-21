export function ClosingCta() {
  return (
    <section className="hh-section bg-ink text-bg hh-closing" style={{ padding: '110px 56px' }}>
      <div style={{ maxWidth: 780 }}>
        <div
          className="font-mono"
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: 1,
            marginBottom: 24,
          }}
        >
          {'// BEGIN'}
        </div>
        <div
          className="hh-closing-h1"
          style={{
            fontSize: 60,
            fontWeight: 600,
            letterSpacing: '-2px',
            lineHeight: 1.05,
            marginBottom: 28,
            textWrap: 'balance',
          }}
        >
          A little more breathing room,
          <br />
          <em className="text-accent" style={{ fontStyle: 'italic', fontWeight: 500 }}>
            built into the week.
          </em>
        </div>
        <div
          style={{
            fontSize: 18,
            lineHeight: 1.6,
            color: 'rgba(255,255,255,0.65)',
            marginBottom: 36,
            maxWidth: 560,
          }}
        >
          Try HomeHub free for 30 days. If it&apos;s not helping, leave. We&apos;ll export
          everything for you on the way out.
        </div>
        <div className="flex items-center" style={{ gap: 10 }}>
          <a
            href="https://app.homehub.com/signup"
            className="bg-bg text-ink"
            style={{
              padding: '14px 26px',
              borderRadius: 3,
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            Try it free →
          </a>
          <a
            href="#how-it-works"
            className="text-bg"
            style={{
              padding: '14px 26px',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 3,
              fontSize: 15,
            }}
          >
            Watch a 2-min tour
          </a>
        </div>
      </div>
    </section>
  );
}
