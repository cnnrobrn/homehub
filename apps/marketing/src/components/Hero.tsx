import { Logo } from './Logo';

import { APP_LOGIN_URL } from '@/lib/app-url';


type AreaKey = 'money' | 'meals' | 'plans' | 'people';

const AREAS: Record<AreaKey, string> = {
  money: 'var(--color-area-money)',
  meals: 'var(--color-area-meals)',
  plans: 'var(--color-area-plans)',
  people: 'var(--color-area-people)',
};

type DashboardItem = [title: string, detail: string, area: AreaKey];

const DASHBOARD: Array<{ day: string; items: DashboardItem[] }> = [
  {
    day: 'TOMORROW',
    items: [
      ['Rent is due', 'We set aside $2,400 last week — all good', 'money'],
      ['Use the basil', 'Before it turns. Pesto night?', 'meals'],
    ],
  },
  {
    day: 'WEDNESDAY',
    items: [['Leo’s class trip', 'Needs a packed lunch + $15', 'plans']],
  },
  {
    day: 'FRIDAY',
    items: [['Dinner at Tala’s', '7:30pm · bring a bottle of wine', 'people']],
  },
  {
    day: 'NEXT WEEK',
    items: [['Mom’s birthday', 'She turns 62 on Tuesday', 'people']],
  },
];

export function Hero() {
  return (
    <section
      className="hh-section hh-hero"
      style={{
        padding: '100px 56px 64px',
        display: 'grid',
        gridTemplateColumns: '1.1fr 1fr',
        gap: 64,
        alignItems: 'center',
      }}
    >
      <div>
        <div
          className="text-accent font-mono flex items-center"
          style={{ fontSize: 11, letterSpacing: 1, marginBottom: 20, gap: 8 }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: 'var(--color-accent)',
              display: 'inline-block',
            }}
          />
          FOR THE WHOLE HOUSEHOLD
        </div>
        <h1
          className="hh-hero-h1"
          style={{
            fontSize: 64,
            fontWeight: 600,
            lineHeight: 1.02,
            letterSpacing: '-2px',
            margin: 0,
            textWrap: 'balance',
          }}
        >
          The quiet place
          <br />
          your family
          <br />
          runs from.
        </h1>
        <p
          className="text-sub"
          style={{
            fontSize: 19,
            lineHeight: 1.55,
            marginTop: 28,
            maxWidth: 520,
          }}
        >
          HomeHub keeps track of the bills, the dinners, the birthdays, and the weekend plans — so
          you don&apos;t have to hold it all in your head. Less juggling. More time for the people
          in the house.
        </p>
        <div className="flex items-center" style={{ gap: 10, marginTop: 36 }}>
          <a
            href={APP_LOGIN_URL}
            className="bg-ink text-bg"
            style={{
              padding: '13px 22px',
              borderRadius: 3,
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            Try it free →
          </a>
          <a
            href="#how-it-works"
            className="text-ink border-rule"
            style={{
              padding: '13px 22px',
              border: '1px solid var(--color-rule)',
              borderRadius: 3,
              fontSize: 15,
            }}
          >
            See a tour
          </a>
        </div>
        <div
          className="text-sub hh-hero-meta flex"
          style={{ marginTop: 22, fontSize: 13, gap: 18 }}
        >
          <span>No credit card</span>
          <span>·</span>
          <span>Takes 2 minutes</span>
          <span>·</span>
          <span>Works on your phone</span>
        </div>
      </div>

      <div
        className="hh-hero-preview"
        style={{
          background: 'var(--color-card)',
          borderRadius: 10,
          border: '1px solid var(--color-rule)',
          boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-rule)',
            background: 'var(--color-warm-sand)',
          }}
        >
          <div className="flex items-center" style={{ gap: 9 }}>
            <Logo size={16} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>The Ashford family</span>
          </div>
          <span className="text-sub font-mono" style={{ fontSize: 11 }}>
            Sunday evening
          </span>
        </div>
        <div style={{ padding: '22px 24px' }}>
          <div className="text-sub" style={{ fontSize: 14, marginBottom: 4 }}>
            Good evening, Elena.
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.4px',
              marginBottom: 20,
              textWrap: 'balance',
            }}
          >
            Here&apos;s what&apos;s coming up this week.
          </div>

          {DASHBOARD.map(({ day, items }) => (
            <div key={day} style={{ marginBottom: 14 }}>
              <div
                className="text-sub font-mono"
                style={{ fontSize: 10, letterSpacing: 0.8, marginBottom: 6 }}
              >
                {day}
              </div>
              {items.map(([title, detail, area]) => (
                <div
                  key={title}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '8px 10px',
                    background: 'var(--color-warm-sand)',
                    borderRadius: 4,
                    borderLeft: `3px solid ${AREAS[area]}`,
                    marginBottom: 4,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
                    <div className="text-sub" style={{ fontSize: 12, marginTop: 1 }}>
                      {detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
