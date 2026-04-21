const STEPS: Array<[string, string, string]> = [
  [
    '01',
    'Connect the basics',
    'Link your calendars, your bank (read-only), and your grocery app if you use one. Five minutes, maybe less.',
  ],
  [
    '02',
    'Invite the household',
    'Add your partner, your kids, a grandparent, a babysitter. Everyone sees just what makes sense for them.',
  ],
  [
    '03',
    'Let it breathe',
    'HomeHub starts quietly gathering the threads. By next weekend you’ll get a short Sunday recap — what’s coming, what to know.',
  ],
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="hh-section hh-how-it-works border-rule border-t border-b"
      style={{
        padding: '100px 56px',
        background: 'var(--color-warm-sand)',
      }}
    >
      <div
        className="text-sub font-mono"
        style={{ fontSize: 11, letterSpacing: 1, marginBottom: 8 }}
      >
        {'// HOW IT WORKS'}
      </div>
      <div
        style={{
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: '-1.4px',
          maxWidth: 720,
          marginBottom: 56,
          textWrap: 'balance',
        }}
      >
        Set it up on a Sunday. Forget about it by Tuesday.
      </div>
      <div
        className="hh-how-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 24,
        }}
      >
        {STEPS.map(([num, title, body]) => (
          <div
            key={num}
            className="bg-card"
            style={{
              border: '1px solid var(--color-rule)',
              borderRadius: 6,
              padding: 28,
            }}
          >
            <div
              className="text-accent font-mono"
              style={{ fontSize: 11, marginBottom: 12, letterSpacing: 1 }}
            >
              {num}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.4px',
                marginBottom: 10,
              }}
            >
              {title}
            </div>
            <div className="text-sub" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
              {body}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
