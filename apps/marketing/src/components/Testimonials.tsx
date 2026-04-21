const QUOTES: Array<[quote: string, who: string]> = [
  [
    'I stopped being the only one who knew when things were due. My husband actually uses it — that’s a miracle.',
    'Lena · mother of two · Minneapolis',
  ],
  [
    'Our grocery list used to be three text threads and a whiteboard. Now it’s just there. We eat better.',
    'Marcus & Jordan · couple · Brooklyn',
  ],
  [
    'The weekly Sunday recap is my favorite thing. I sit down with coffee and the week makes sense.',
    'Priya · mother of three · Austin',
  ],
];

export function Testimonials() {
  return (
    <section className="hh-section" style={{ padding: '100px 56px' }}>
      <div
        className="text-sub font-mono"
        style={{ fontSize: 11, letterSpacing: 1, marginBottom: 8 }}
      >
        {'// FROM FAMILIES LIKE YOURS'}
      </div>
      <div
        style={{
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: '-1.4px',
          maxWidth: 680,
          marginBottom: 56,
          textWrap: 'balance',
        }}
      >
        A little less on your shoulders.
      </div>
      <div
        className="hh-testimonials-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 20,
        }}
      >
        {QUOTES.map(([quote, who]) => (
          <div
            key={who}
            className="bg-card"
            style={{
              border: '1px solid var(--color-rule)',
              borderRadius: 8,
              padding: 26,
            }}
          >
            <div
              style={{
                fontSize: 15,
                lineHeight: 1.55,
                marginBottom: 18,
                textWrap: 'pretty',
              }}
            >
              &ldquo;{quote}&rdquo;
            </div>
            <div className="text-sub font-mono" style={{ fontSize: 12, letterSpacing: 0.3 }}>
              {who}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
