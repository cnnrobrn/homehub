export function Quote() {
  return (
    <section
      className="hh-section hh-quote border-rule border-t border-b"
      style={{
        padding: '80px 56px',
        background: 'var(--color-warm-sand)',
      }}
    >
      <div
        style={{
          maxWidth: 860,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 500,
            lineHeight: 1.3,
            letterSpacing: '-0.6px',
            textWrap: 'balance',
          }}
        >
          &ldquo;I was the one who remembered everything — the permission slips, the pediatrician,
          the gas bill, when the in-laws were visiting. It was a second job I never signed up
          for.&rdquo;
        </div>
        <div
          className="text-sub font-mono"
          style={{ marginTop: 24, fontSize: 13, letterSpacing: 0.5 }}
        >
          — A HOMEHUB FAMILY, YEAR ONE
        </div>
        <div
          className="text-sub"
          style={{
            marginTop: 48,
            fontSize: 18,
            lineHeight: 1.6,
            maxWidth: 640,
            margin: '48px auto 0',
          }}
        >
          HomeHub is the shared brain for your household — so nobody has to be the one who
          remembers. It sorts, reminds, and quietly gets out of the way.
        </div>
      </div>
    </section>
  );
}
