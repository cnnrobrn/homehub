// V2 — Indie software, life-tracker edition. Events, food/groceries, plans with friends.
const V2Indie = () => {
  const W = 1280,
    H = 2400;
  const bg = '#fafaf7';
  const card = '#ffffff';
  const ink = '#1a1a17';
  const sub = '#77736c';
  const accent = 'oklch(0.58 0.11 200)'; // muted teal
  const rule = 'rgba(26,26,23,0.1)';
  const font = '"Inter", -apple-system, sans-serif';
  const mono = '"JetBrains Mono", ui-monospace, monospace';

  const Check = () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke={accent}
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M3 7.5L5.5 10 11 4" />
    </svg>
  );

  return (
    <div
      style={{
        width: W,
        minHeight: H,
        background: bg,
        color: ink,
        fontFamily: font,
        position: 'relative',
      }}
    >
      {/* nav */}
      <div
        style={{
          padding: '20px 56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${rule}`,
          background: bg,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="5" width="16" height="12" rx="1" stroke={ink} strokeWidth="1.4" />
            <path d="M1 8L9 1l8 7" stroke={ink} strokeWidth="1.4" strokeLinejoin="round" />
            <circle cx="9" cy="12" r="1.5" fill={accent} />
          </svg>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>homehub</div>
          <span style={{ fontSize: 11, fontFamily: mono, color: sub, marginLeft: 4 }}>v0.8.2</span>
        </div>
        <div style={{ display: 'flex', gap: 28, fontSize: 13, color: sub }}>
          <span>Features</span>
          <span>Self-host</span>
          <span>Docs</span>
          <span>Changelog</span>
          <span>GitHub ↗</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ padding: '7px 12px', fontSize: 13, color: sub }}>Sign in</div>
          <div
            style={{
              padding: '7px 14px',
              background: ink,
              color: bg,
              borderRadius: 3,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Try it free
          </div>
        </div>
      </div>

      {/* hero */}
      <div
        style={{
          padding: '88px 56px 40px',
          display: 'grid',
          gridTemplateColumns: '1.05fr 1fr',
          gap: 64,
          alignItems: 'center',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: accent,
              fontFamily: mono,
              letterSpacing: 1,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: accent,
                display: 'inline-block',
              }}
            />
            OPEN SOURCE · SELF-HOSTABLE · MIT
          </div>
          <h1
            style={{
              fontSize: 62,
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: -2,
              margin: 0,
              textWrap: 'balance',
            }}
          >
            The quiet notebook
            <br />
            for everything
            <br />
            in your week.
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: sub, marginTop: 28, maxWidth: 480 }}>
            Track the dinners, the groceries, the running, the birthdays, the trips with friends —
            all in one place. No streaks, no nudges, no selling you anything. Just a calm home for
            the small stuff.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 36, alignItems: 'center' }}>
            <div
              style={{
                padding: '12px 20px',
                background: ink,
                color: bg,
                borderRadius: 3,
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Start free →
            </div>
            <div
              style={{
                padding: '12px 20px',
                border: `1px solid ${rule}`,
                borderRadius: 3,
                fontSize: 14,
                fontFamily: mono,
                color: ink,
              }}
            >
              <span style={{ color: sub }}>$</span> docker run homehub
            </div>
          </div>
          <div style={{ marginTop: 20, fontSize: 12, color: sub, fontFamily: mono }}>
            Free forever when self-hosted · $4/mo hosted
          </div>
        </div>

        {/* card collage — events, groceries, plans */}
        <div style={{ position: 'relative', height: 520 }}>
          {/* Card 1 — grocery list */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 250,
              background: card,
              borderRadius: 6,
              border: `1px solid ${rule}`,
              padding: 18,
              boxShadow: '0 8px 24px -8px rgba(0,0,0,.1)',
              transform: 'rotate(-3deg)',
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
            >
              <div style={{ fontSize: 10, fontFamily: mono, color: sub, letterSpacing: 0.5 }}>
                GROCERIES · SAT
              </div>
              <div style={{ fontSize: 10, fontFamily: mono, color: sub }}>3/7</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>Weekend shop</div>
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.9, color: ink }}>
              {[
                ['Sourdough', true],
                ['Eggs — 12', true],
                ['Tomatoes', true],
                ['Olive oil', false],
                ['Lemons', false],
                ['Basil', false],
                ['Ricotta', false],
              ].map(([t, done]) => (
                <div
                  key={t}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    textDecoration: done ? 'line-through' : 'none',
                    color: done ? sub : ink,
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      border: `1.4px solid ${done ? accent : sub}`,
                      borderRadius: 2,
                      background: done ? accent : 'transparent',
                      display: 'inline-block',
                    }}
                  />
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* Card 2 — dinner plan with friends */}
          <div
            style={{
              position: 'absolute',
              top: 40,
              right: 0,
              width: 270,
              background: card,
              borderRadius: 6,
              border: `1px solid ${rule}`,
              padding: 18,
              boxShadow: '0 8px 24px -8px rgba(0,0,0,.1)',
              transform: 'rotate(2deg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: accent }} />
              <div style={{ fontSize: 10, fontFamily: mono, color: sub, letterSpacing: 0.5 }}>
                FRIDAY · 7:30PM
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>Dinner at Tala's</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 4, lineHeight: 1.5 }}>
              bringing: roast chicken + the natural wine from ordinary habit
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: -6, alignItems: 'center' }}>
              {['#c9b89a', '#8a7864', '#d4a88a', '#b5a38a'].map((c, i) => (
                <div
                  key={i}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: c,
                    border: `2px solid ${card}`,
                    marginLeft: i ? -8 : 0,
                  }}
                />
              ))}
              <div style={{ marginLeft: 10, fontSize: 12, color: sub, fontFamily: mono }}>
                + Mika, Sam, Jo
              </div>
            </div>
          </div>

          {/* Card 3 — run log / tracking */}
          <div
            style={{
              position: 'absolute',
              top: 220,
              left: 30,
              width: 280,
              background: card,
              borderRadius: 6,
              border: `1px solid ${rule}`,
              padding: 18,
              boxShadow: '0 8px 24px -8px rgba(0,0,0,.1)',
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
            >
              <div style={{ fontSize: 10, fontFamily: mono, color: sub, letterSpacing: 0.5 }}>
                TRACK · RUNS
              </div>
              <div style={{ fontSize: 10, fontFamily: mono, color: sub }}>APR · WEEK 3</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>18.2 km this week</div>
            {/* tiny bar chart */}
            <div
              style={{ marginTop: 14, display: 'flex', alignItems: 'flex-end', gap: 6, height: 42 }}
            >
              {[0, 5, 0, 3, 6, 0, 4.2].map((v, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: `${(v / 6) * 34}px`,
                      background: v ? accent : '#ede8de',
                      borderRadius: 1,
                      opacity: v ? 1 : 0.5,
                    }}
                  />
                  <div style={{ fontSize: 9, fontFamily: mono, color: sub }}>{'MTWTFSS'[i]}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: sub, lineHeight: 1.5 }}>
              avg pace 5:42/km · best: 5:18 on Friday's park loop
            </div>
          </div>

          {/* Card 4 — events / birthday */}
          <div
            style={{
              position: 'absolute',
              top: 360,
              right: 10,
              width: 240,
              background: card,
              borderRadius: 6,
              border: `1px solid ${rule}`,
              padding: 16,
              boxShadow: '0 8px 24px -8px rgba(0,0,0,.1)',
              transform: 'rotate(-2deg)',
            }}
          >
            <div style={{ fontSize: 10, fontFamily: mono, color: sub, letterSpacing: 0.5 }}>
              BIRTHDAY · IN 9 DAYS
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>Mom turns 62</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 4, lineHeight: 1.5 }}>
              last year: that gardening book + blue scarf. she loved both.
            </div>
            <div
              style={{
                marginTop: 10,
                padding: 8,
                background: '#f4f1ea',
                borderRadius: 3,
                fontSize: 11,
                color: sub,
                fontFamily: mono,
              }}
            >
              idea · pottery class, Sat mornings
            </div>
          </div>

          {/* Card 5 — tiny meal log */}
          <div
            style={{
              position: 'absolute',
              top: 430,
              left: 0,
              width: 200,
              background: card,
              borderRadius: 6,
              border: `1px solid ${rule}`,
              padding: 14,
              boxShadow: '0 8px 24px -8px rgba(0,0,0,.1)',
              transform: 'rotate(3deg)',
            }}
          >
            <div style={{ fontSize: 10, fontFamily: mono, color: sub, letterSpacing: 0.5 }}>
              DINNER · TUES
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>Miso cod, rice</div>
            <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>
              made again — 3rd time · ★★★★★
            </div>
          </div>
        </div>
      </div>

      {/* social proof strip */}
      <div
        style={{
          padding: '28px 56px',
          borderTop: `1px solid ${rule}`,
          borderBottom: `1px solid ${rule}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          fontFamily: mono,
          color: sub,
          letterSpacing: 0.5,
        }}
      >
        <span>24,812 QUIET USERS</span>
        <span>★ 4,281 GITHUB STARS</span>
        <span>312 CONTRIBUTORS</span>
        <span>MIT LICENSED</span>
        <span>NO ADS · NO NUDGES</span>
      </div>

      {/* features — four-up, life-tracker flavored */}
      <div style={{ padding: '80px 56px' }}>
        <div
          style={{ fontSize: 11, color: sub, fontFamily: mono, letterSpacing: 1, marginBottom: 8 }}
        >
          // WHAT IT'S FOR
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: -1,
            maxWidth: 680,
            marginBottom: 48,
          }}
        >
          The small stuff of a life — in one calm, searchable place.
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2,1fr)',
            gap: 2,
            background: rule,
            border: `1px solid ${rule}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {[
            [
              'Track what matters',
              'Runs, reads, meals cooked, coffees tried, hours slept. Log a line, move on. Look back whenever you want — no streaks guilting you into it.',
            ],
            [
              'Food & groceries',
              'Weekly shops, meal ideas, a recipe you liked twice. HomeHub keeps the running list and remembers which tomatoes were actually good.',
            ],
            [
              'Plans with people',
              'Dinners, trips, birthdays. Who you owe a call. Who brought what. Keep the small threads with the people you care about from fraying.',
            ],
            [
              'Events & moments',
              'Concerts you went to, the hike that was actually hard, the movie you cried at. A quiet record of the year, in your own words.',
            ],
          ].map(([t, d], i) => (
            <div key={t} style={{ background: bg, padding: 32 }}>
              <div style={{ fontSize: 11, color: accent, fontFamily: mono, marginBottom: 10 }}>
                0{i + 1} —
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, letterSpacing: -0.3 }}>
                {t}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: sub }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* A week in HomeHub — calendar-like preview */}
      <div style={{ padding: '80px 56px', borderTop: `1px solid ${rule}` }}>
        <div
          style={{ fontSize: 11, color: sub, fontFamily: mono, letterSpacing: 1, marginBottom: 8 }}
        >
          // A WEEK
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: -1,
            marginBottom: 40,
            maxWidth: 640,
          }}
        >
          One view, everything in its place.
        </div>
        <div
          style={{
            border: `1px solid ${rule}`,
            borderRadius: 6,
            background: card,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              borderBottom: `1px solid ${rule}`,
            }}
          >
            {['MON 14', 'TUE 15', 'WED 16', 'THU 17', 'FRI 18', 'SAT 19', 'SUN 20'].map((d, i) => (
              <div
                key={d}
                style={{
                  padding: '14px 16px',
                  fontSize: 11,
                  fontFamily: mono,
                  color: sub,
                  letterSpacing: 0.5,
                  borderRight: i < 6 ? `1px solid ${rule}` : 'none',
                  background: i === 4 ? '#f4f1ea' : 'transparent',
                }}
              >
                {d}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: 280 }}>
            {[
              [['5k run · park', 'track', accent]],
              [
                ['miso cod', 'food'],
                ['pottery class idea', 'note'],
              ],
              [['8hr sleep', 'track', accent]],
              [['finish "klara"', 'read']],
              [
                ['dinner @ tala', 'plan', accent],
                ['bring wine', 'food'],
              ],
              [
                ['grocery shop', 'food'],
                ['coffee w/ mika', 'plan'],
              ],
              [
                ['sunday roast', 'food'],
                ['call mom', 'plan'],
              ],
            ].map((items, i) => (
              <div
                key={i}
                style={{
                  padding: 10,
                  borderRight: i < 6 ? `1px solid ${rule}` : 'none',
                  background: i === 4 ? '#fbf8f2' : 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {items.map(([t, tag, col], k) => (
                  <div
                    key={k}
                    style={{
                      padding: '6px 8px',
                      background: bg,
                      borderRadius: 3,
                      fontSize: 11,
                      borderLeft: `2px solid ${col || rule}`,
                    }}
                  >
                    <div style={{ color: ink, fontWeight: 500, marginBottom: 2 }}>{t}</div>
                    <div style={{ fontSize: 9, fontFamily: mono, color: sub, letterSpacing: 0.5 }}>
                      {tag.toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* self-host block */}
      <div
        style={{
          padding: '80px 56px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 48,
          alignItems: 'center',
          background: '#f2efe8',
          borderTop: `1px solid ${rule}`,
          borderBottom: `1px solid ${rule}`,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: sub,
              fontFamily: mono,
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            // YOURS TO KEEP
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: -1,
              marginBottom: 16,
              textWrap: 'balance',
            }}
          >
            Free forever when you run it yourself.
          </div>
          <div
            style={{ fontSize: 15, lineHeight: 1.6, color: sub, marginBottom: 24, maxWidth: 440 }}
          >
            HomeHub is a single Docker container. Run it on a Raspberry Pi in your closet, a cheap
            VPS, or your laptop. Your notes, lists, and logs live as plain files on your disk —
            portable, inspectable, yours.
          </div>
          {[
            'Single docker-compose file, 12 lines',
            'SQLite database · one backup file',
            'Notes stored as plain markdown',
            'No telemetry, no analytics, no accounts',
          ].map((x) => (
            <div
              key={x}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                marginBottom: 10,
                fontSize: 14,
              }}
            >
              <Check />
              <span>{x}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            background: '#1a1a17',
            borderRadius: 6,
            padding: 24,
            fontFamily: mono,
            fontSize: 13,
            lineHeight: 1.7,
            color: '#d8d3c8',
          }}
        >
          <div style={{ color: '#77736c', marginBottom: 12 }}># 1. pull and run</div>
          <div>
            <span style={{ color: '#77736c' }}>$</span> docker run -d \
          </div>
          <div style={{ paddingLeft: 16 }}>-p 3000:3000 \</div>
          <div style={{ paddingLeft: 16 }}>-v ~/homehub:/data \</div>
          <div style={{ paddingLeft: 16, color: accent }}>homehub/homehub:latest</div>
          <div style={{ marginTop: 18, color: '#77736c' }}># 2. open in your browser</div>
          <div>
            <span style={{ color: '#77736c' }}>→</span> http://localhost:3000
          </div>
          <div style={{ marginTop: 18, color: '#77736c' }}>
            # 3. you're done. no cloud, no accounts.
          </div>
        </div>
      </div>

      {/* footer */}
      <div
        style={{
          padding: '56px 56px 28px',
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
          gap: 32,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1" y="5" width="16" height="12" rx="1" stroke={ink} strokeWidth="1.4" />
              <path d="M1 8L9 1l8 7" stroke={ink} strokeWidth="1.4" strokeLinejoin="round" />
              <circle cx="9" cy="12" r="1.5" fill={accent} />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600 }}>homehub</div>
          </div>
          <div style={{ fontSize: 12, color: sub, fontFamily: mono, lineHeight: 1.7 }}>
            Built in the open
            <br />
            github.com/homehub
            <br />
            MIT licensed, forever
          </div>
        </div>
        {[
          ['product', ['features', 'pricing', 'changelog', 'status']],
          ['open source', ['github', 'docs', 'contribute', 'sponsors']],
          ['community', ['discord', 'forum', 'blog', 'newsletter']],
          ['more', ['about', 'contact', 'privacy', 'terms']],
        ].map(([h, items]) => (
          <div key={h}>
            <div
              style={{
                fontSize: 11,
                fontFamily: mono,
                color: sub,
                letterSpacing: 0.5,
                marginBottom: 12,
              }}
            >
              {h}
            </div>
            {items.map((x) => (
              <div key={x} style={{ fontSize: 13, marginBottom: 7 }}>
                {x}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        style={{
          padding: '16px 56px',
          borderTop: `1px solid ${rule}`,
          fontSize: 11,
          fontFamily: mono,
          color: sub,
          letterSpacing: 0.5,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <div>© 2026 · homehub collective · mit</div>
        <div>made quietly · for the small stuff of a life</div>
      </div>
    </div>
  );
};

window.V2Indie = V2Indie;
