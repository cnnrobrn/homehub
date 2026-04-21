import { Logo } from './Logo';

const GROUPS: Array<[string, string[]]> = [
  ['product', ['How it works', 'For families', 'Pricing', 'Try a tour']],
  ['help', ['Getting started', 'Invite your family', 'Tips', 'Contact']],
  ['open source', ['GitHub', 'Self-host guide', 'Changelog', 'Contribute']],
  ['more', ['About', 'Privacy', 'Terms', 'Press']],
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
            {items.map((label) => (
              <div key={label} style={{ fontSize: 13, marginBottom: 7 }}>
                {label}
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
