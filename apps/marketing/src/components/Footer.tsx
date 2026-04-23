import { Logo } from './Logo';

type FooterLink = { label: string; href: string; external?: boolean };

const GROUPS: Array<[string, FooterLink[]]> = [
  [
    'product',
    [
      { label: 'How it works', href: '/#how-it-works' },
      { label: 'For families', href: '/#for-families' },
      { label: 'Pricing', href: '/#pricing' },
      { label: 'Try a tour', href: '/tour' },
    ],
  ],
  [
    'help',
    [
      { label: 'Getting started', href: '/getting-started' },
      { label: 'Invite your family', href: '/invite' },
      { label: 'Tips', href: '/tips' },
      { label: 'Contact', href: '/contact' },
    ],
  ],
  [
    'open source',
    [
      { label: 'GitHub', href: 'https://github.com/homehub', external: true },
      { label: 'Self-host guide', href: '/self-host' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Contribute', href: '/contribute' },
    ],
  ],
  [
    'more',
    [
      { label: 'About', href: '/about' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Press', href: '/press' },
    ],
  ],
];

export function Footer() {
  return (
    <footer>
      <div
        className="hh-section hh-footer-grid"
        style={{
          padding: '56px 56px 28px',
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
          gap: 32,
        }}
      >
        <div>
          <div className="flex items-center" style={{ gap: 9, marginBottom: 12 }}>
            <Logo />
            <div style={{ fontSize: 14, fontWeight: 600 }}>homehub</div>
          </div>
          <div className="text-sub" style={{ fontSize: 13, lineHeight: 1.65, maxWidth: 260 }}>
            A quiet shared brain for the household. Open source, forever free to self-host.
          </div>
        </div>
        {GROUPS.map(([heading, items]) => (
          <div key={heading}>
            <div
              className="text-sub font-mono"
              style={{ fontSize: 11, letterSpacing: 0.5, marginBottom: 12 }}
            >
              {heading}
            </div>
            {items.map((item) => (
              <div key={item.label} style={{ fontSize: 13, marginBottom: 7 }}>
                <a
                  href={item.href}
                  className="text-ink hover:text-accent transition-colors"
                  {...(item.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                >
                  {item.label}
                </a>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        className="hh-section text-sub font-mono border-rule flex justify-between border-t"
        style={{
          padding: '16px 56px',
          fontSize: 11,
          letterSpacing: 0.5,
        }}
      >
        <div>© 2026 · homehub · mit licensed</div>
        <div>made for the people at home</div>
      </div>
    </footer>
  );
}
