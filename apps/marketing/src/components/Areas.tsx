type Area = {
  key: string;
  color: string;
  title: string;
  description: string;
  example: string;
};

const AREAS: Area[] = [
  {
    key: 'money',
    color: 'var(--color-area-money)',
    title: 'Money',
    description:
      'The bills, the budgets, who paid for what on vacation. HomeHub watches the shared accounts and flags things worth knowing — before they become surprises.',
    example: '“Heads up — Spotify Family renewed. Nobody’s used it in 6 weeks.”',
  },
  {
    key: 'meals',
    color: 'var(--color-area-meals)',
    title: 'Meals',
    description:
      'What’s for dinner, what’s in the fridge, what needs picking up. A rolling meal plan and grocery list that’s always up to date.',
    example: '“Your basil goes off tomorrow. Thursday’s pasta needs it.”',
  },
  {
    key: 'plans',
    color: 'var(--color-area-plans)',
    title: 'Plans',
    description:
      'Trips, school events, date nights, the weekend. Everyone’s calendars live in one view so you can see the week in a glance.',
    example: '“You and Sam are both free Friday through Sunday in three weeks.”',
  },
  {
    key: 'people',
    color: 'var(--color-area-people)',
    title: 'People',
    description:
      'Birthdays, anniversaries, the friends you’ve been meaning to see, the neighbors who had you over. The small threads kept from fraying.',
    example: '“You haven’t seen the Garcias in four months. They hosted last time.”',
  },
];

export function Areas() {
  return (
    <section id="for-families" className="hh-section" style={{ padding: '100px 56px' }}>
      <div
        className="text-sub font-mono"
        style={{ fontSize: 11, letterSpacing: 1, marginBottom: 8 }}
      >
        {'// WHAT IT HANDLES'}
      </div>
      <div
        style={{
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: '-1.4px',
          maxWidth: 680,
          marginBottom: 16,
          textWrap: 'balance',
        }}
      >
        Four corners of family life — in one gentle place.
      </div>
      <div
        className="text-sub"
        style={{ fontSize: 17, lineHeight: 1.6, maxWidth: 560, marginBottom: 56 }}
      >
        No spreadsheets. No separate apps. Just the stuff a home actually needs to keep running.
      </div>

      <div
        className="hh-areas-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 20,
        }}
      >
        {AREAS.map((area) => (
          <div
            key={area.key}
            className="bg-card"
            style={{
              border: '1px solid var(--color-rule)',
              borderRadius: 8,
              padding: '28px 28px 24px',
            }}
          >
            <div className="flex items-center" style={{ gap: 10, marginBottom: 14 }}>
              <div
                className="flex items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: area.color,
                  opacity: 0.15,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: area.color,
                  }}
                />
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px' }}>
                {area.title}
              </div>
            </div>
            <div className="text-sub" style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 18 }}>
              {area.description}
            </div>
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--color-warm-sand)',
                borderRadius: 4,
                fontSize: 13.5,
                lineHeight: 1.5,
                borderLeft: `3px solid ${area.color}`,
              }}
            >
              {area.example}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
