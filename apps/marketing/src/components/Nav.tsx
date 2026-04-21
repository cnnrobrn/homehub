'use client';

import { useEffect, useState } from 'react';

import { Logo } from './Logo';

const NAV_LINKS: Array<{ label: string; href: string }> = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'For families', href: '#for-families' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Open source', href: '#open-source' },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className="hh-nav hh-section bg-bg border-rule sticky top-0 z-10 flex items-center justify-between border-b"
      style={{ padding: '20px 56px' }}
      data-scrolled={scrolled ? 'true' : 'false'}
    >
      <div className="flex items-center" style={{ gap: 9 }}>
        <Logo />
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px' }}>homehub</div>
      </div>
      <div className="hh-nav-links text-sub flex" style={{ gap: 28, fontSize: 13 }}>
        {NAV_LINKS.map((link) => (
          <a key={link.label} href={link.href} className="hover:text-ink transition-colors">
            {link.label}
          </a>
        ))}
      </div>
      <div className="hh-nav-auth flex items-center" style={{ gap: 8 }}>
        <a
          href="https://app.homehub.com/login"
          className="text-sub hover:text-ink transition-colors"
          style={{ padding: '7px 12px', fontSize: 13 }}
        >
          Sign in
        </a>
        <a
          href="https://app.homehub.com/signup"
          className="bg-ink text-bg"
          style={{
            padding: '7px 14px',
            borderRadius: 3,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Try it free
        </a>
      </div>
    </nav>
  );
}
