type Plan = {
  title: string;
  price: string;
  suffix: string;
  description: string;
  cta: string;
  href: string;
  primary: boolean;
};

const PLANS: Plan[] = [
  {
    title: 'Hosted',
    price: '$8',
    suffix: 'per month · per household',
    description: 'We run it. You log in. Everyone in the house is included. Cancel anytime.',
    cta: 'Start a free trial',
    href: 'https://app.homehub.com/signup',
    primary: true,
  },
  {
    title: 'Self-hosted',
    price: 'Free',
    suffix: 'forever',
    description:
      'Run it on your own machine. The whole thing is open source. We’ll help you get set up.',
    cta: 'See the guide',
    href: 'https://github.com/homehub',
    primary: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="hh-section" style={{ padding: '100px 56px' }}>
      <div
        className="text-sub font-mono"
        style={{ fontSize: 11, letterSpacing: 1, marginBottom: 8 }}
      >
        {'// PRICING'}
      </div>
      <div
        style={{
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: '-1.4px',
          maxWidth: 640,
          marginBottom: 48,
          textWrap: 'balance',
        }}
      >
        One price. Whole household.
      </div>
      <div
        className="hh-pricing-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 20,
          maxWidth: 880,
        }}
      >
        {PLANS.map((plan) => {
          const primary = plan.primary;
          const labelColor = primary ? 'rgba(255,255,255,0.5)' : 'var(--color-sub)';
          const priceSuffixColor = primary ? 'rgba(255,255,255,0.6)' : 'var(--color-sub)';
          const descColor = primary ? 'rgba(255,255,255,0.7)' : 'var(--color-sub)';
          return (
            <div
              key={plan.title}
              style={{
                background: primary ? 'var(--color-ink)' : 'var(--color-card)',
                color: primary ? 'var(--color-bg)' : 'var(--color-ink)',
                border: `1px solid ${primary ? 'var(--color-ink)' : 'var(--color-rule)'}`,
                borderRadius: 8,
                padding: 32,
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 13,
                  color: labelColor,
                  letterSpacing: 0.5,
                  marginBottom: 14,
                }}
              >
                {plan.title.toUpperCase()}
              </div>
              <div className="flex items-baseline" style={{ gap: 10, marginBottom: 8 }}>
                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 600,
                    letterSpacing: '-1.6px',
                  }}
                >
                  {plan.price}
                </div>
                <div style={{ fontSize: 14, color: priceSuffixColor }}>{plan.suffix}</div>
              </div>
              <div
                style={{
                  fontSize: 15,
                  lineHeight: 1.55,
                  color: descColor,
                  marginBottom: 28,
                }}
              >
                {plan.description}
              </div>
              <a
                href={plan.href}
                style={{
                  padding: '12px 18px',
                  display: 'inline-block',
                  background: primary ? 'var(--color-bg)' : 'var(--color-ink)',
                  color: primary ? 'var(--color-ink)' : 'var(--color-bg)',
                  borderRadius: 3,
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {plan.cta} →
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
